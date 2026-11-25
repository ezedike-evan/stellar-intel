import { NextResponse } from 'next/server';
import { getClientIp } from '@/lib/api/rate-limit';
import { apiErrorResponse } from '@/lib/api/response';
import { getLogger } from '@/lib/logger';
import { isFlag } from '@/lib/flags';
import { hasScope, hashApiKey, hashesEqual, parseApiKey, type ApiScope } from './api-keys';
import { getApiKeyStore, type CallerTier } from './key-store';
import { getTokenSecret, looksLikeToken, verifyCallerToken } from './token';

// ─── Caller identity (AGS003, AGS008, AGS011, AGS015) ─────────────────────────
//
// One resolver for every surface (REST v1, MCP, GraphQL): request headers in,
// Caller out. A bad credential is rejected, never downgraded to anonymous.
// Never log the raw credential.

export type CallerKind = 'anonymous' | 'key' | 'token';
export type CallerTierName = 'anonymous' | CallerTier;

export interface Caller {
  kind: CallerKind;
  /** Stable id for logs and the audit log: 'anonymous' or `key:<keyId>`. Never contains an IP. */
  id: string;
  /** Rate-limit identity: the client IP for anonymous callers (unchanged from today), `key:<keyId>` for keyed ones. */
  rateLimitKey: string;
  keyId: string | null;
  tier: CallerTierName;
  scopes: readonly ApiScope[];
  maxIntentAmount: string | null;
}

export type CallerErrorCode =
  'invalid_api_key' | 'revoked_api_key' | 'expired_api_key' | 'invalid_token' | 'token_expired';

export type CallerResolution =
  { ok: true; caller: Caller } | { ok: false; status: 401; code: CallerErrorCode; message: string };

const INVALID_KEY_MESSAGE = 'API key is not valid';

function reject(code: CallerErrorCode, message: string): CallerResolution {
  return { ok: false, status: 401, code, message };
}

/** `Authorization: Bearer <value>` (case-insensitive scheme), else `X-API-Key`. */
export function readPresentedCredential(headers: Headers): string | null {
  const authorization = headers.get('authorization');
  const bearer = authorization ? /^bearer\s+(.*)$/i.exec(authorization.trim()) : null;
  const value = (bearer ? bearer[1] : headers.get('x-api-key'))?.trim();
  return value ? value : null;
}

export function anonymousScopes(): readonly ApiScope[] {
  return isFlag('requireKeyForWrites')
    ? ['quotes:read']
    : ['quotes:read', 'intents:write', 'reputation:write'];
}

/**
 * A token acts as the key that minted it, limited to the token's scopes.
 * The key record is loaded on every request, so revoking the key kills its
 * live tokens immediately. No touch: tokens must not cause a write per request.
 */
async function resolveToken(token: string, now: number): Promise<CallerResolution> {
  const secret = getTokenSecret();
  if (!secret) return reject('invalid_token', 'Caller tokens are not enabled on this deployment');

  const verification = await verifyCallerToken(token, secret, now);
  if (!verification.ok) {
    return verification.code === 'token_expired'
      ? reject('token_expired', 'Caller token has expired')
      : reject('invalid_token', 'Caller token is not valid');
  }

  const { sub, scp } = verification.claims;
  const record = await getApiKeyStore().get(sub);
  if (
    !record ||
    record.revokedAt ||
    (record.expiresAt !== null && Date.parse(record.expiresAt) <= now)
  ) {
    return reject('revoked_api_key', 'The API key behind this token has been revoked');
  }

  const id = `key:${sub}`;
  return {
    ok: true,
    caller: {
      kind: 'token',
      id,
      rateLimitKey: id,
      keyId: sub,
      tier: record.tier,
      scopes: scp.filter((scope) => record.scopes.includes(scope)),
      maxIntentAmount: record.maxIntentAmount,
    },
  };
}

async function resolveApiKey(raw: string, now: number): Promise<CallerResolution> {
  const parsed = parseApiKey(raw);
  if (!parsed) return reject('invalid_api_key', INVALID_KEY_MESSAGE);

  const store = getApiKeyStore();
  const record = await store.get(parsed.keyId);
  if (!record || !hashesEqual(await hashApiKey(raw.trim()), record.hash)) {
    return reject('invalid_api_key', INVALID_KEY_MESSAGE);
  }
  if (record.revokedAt) return reject('revoked_api_key', 'API key has been revoked');
  if (record.expiresAt !== null && Date.parse(record.expiresAt) <= now) {
    return reject('expired_api_key', 'API key has expired');
  }

  store.touch(record.keyId, new Date(now).toISOString()).catch((err: unknown) => {
    getLogger('auth.caller').warn(
      { keyId: record.keyId, err: err instanceof Error ? err.message : String(err) },
      'failed to record API key usage'
    );
  });

  const id = `key:${record.keyId}`;
  return {
    ok: true,
    caller: {
      kind: 'key',
      id,
      rateLimitKey: id,
      keyId: record.keyId,
      tier: record.tier,
      scopes: record.scopes,
      maxIntentAmount: record.maxIntentAmount,
    },
  };
}

export async function resolveCaller(
  headers: Headers,
  now: number = Date.now()
): Promise<CallerResolution> {
  const credential = readPresentedCredential(headers);
  if (!credential) {
    return {
      ok: true,
      caller: {
        kind: 'anonymous',
        id: 'anonymous',
        rateLimitKey: getClientIp(headers),
        keyId: null,
        tier: 'anonymous',
        scopes: anonymousScopes(),
        maxIntentAmount: null,
      },
    };
  }
  return looksLikeToken(credential)
    ? resolveToken(credential, now)
    : resolveApiKey(credential, now);
}

/**
 * Gate an unversioned route on a required scope (AGS015).
 *
 * Rejects unauthenticated callers with 401 UNAUTHORIZED, and callers lacking
 * the scope with 403 INSUFFICIENT_SCOPE and a WWW-Authenticate header.
 */
export async function requireCallerScope(
  request: Request,
  scope: ApiScope
): Promise<{ ok: true; caller: Caller } | { ok: false; response: NextResponse }> {
  const resolution = await resolveCaller(request.headers);
  if (!resolution.ok) {
    return {
      ok: false,
      response: apiErrorResponse({ code: 'UNAUTHORIZED', message: resolution.message }, 401),
    };
  }
  const caller = resolution.caller;
  if (!hasScope(caller.scopes, scope)) {
    const res = apiErrorResponse(
      { code: 'INSUFFICIENT_SCOPE', message: `This call needs the "${scope}" scope` },
      403
    );
    res.headers.set('WWW-Authenticate', `Bearer error="insufficient_scope", scope="${scope}"`);
    return { ok: false, response: res };
  }
  return { ok: true, caller };
}
