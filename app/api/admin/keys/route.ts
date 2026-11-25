import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withRequestLogger } from '@/lib/logger';
import { isAdminRequest, throttleFailedAdminAuth } from '@/lib/auth/admin';
import { API_SCOPES, generateApiKey } from '@/lib/auth/api-keys';
import { getApiKeyStore } from '@/lib/auth/key-store';
import { AMOUNT_PATTERN } from '@/lib/patterns';
import type { ApiError } from '@/types';
import { enforceRateLimit } from '@/lib/api/response';

export const runtime = 'nodejs';

// ─── Admin caller-key routes (AGS006) ─────────────────────────────────────────
//
// Only ADMIN_SECRET_KEY authenticates these routes. A caller key carrying the
// `admin` scope must NOT be able to mint keys: a leaked admin-scoped key could
// otherwise issue itself a fresh permanent key. That is why there is no
// resolveCaller()/Authorization path here at all.

const CreateApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z
    .array(z.enum(API_SCOPES))
    .min(1)
    .refine((scopes) => new Set(scopes).size === scopes.length, {
      message: 'scopes must not contain duplicates',
    }),
  tier: z.enum(['standard', 'partner']).default('standard'),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  maxIntentAmount: z.string().regex(AMOUNT_PATTERN).optional(),
});

/** Parsed body, with zod's inferred scope/tier types. */
function forbidden(): NextResponse {
  return NextResponse.json<ApiError>(
    { code: 'FORBIDDEN', message: 'Admin key required' },
    { status: 403 }
  );
}

function validationError(message: string): NextResponse {
  return NextResponse.json<ApiError>({ code: 'VALIDATION_ERROR', message }, { status: 400 });
}

// ─── POST /api/admin/keys ─────────────────────────────────────────────────────
//
// Issues a caller key. The raw key is returned once, here, and never stored or
// shown again — only its SHA-256 hash is persisted.

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.admin.keys.create', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.admin.keys',
      maxRequests: 30,
    });
    if (limited) return limited;

    if (!isAdminRequest(request)) {
      const throttled = await throttleFailedAdminAuth(request);
      if (throttled) return throttled;
      return forbidden();
    }

    const body = await request.json().catch(() => null);
    const parsed = CreateApiKeySchema.safeParse(body);

    if (!parsed.success) {
      logger.warn({ event: 'api_key_validation_failed' });
      return validationError(parsed.error.issues[0]?.message ?? 'Invalid key payload');
    }

    const input = parsed.data;
    const generated = await generateApiKey();
    const createdAt = new Date().toISOString();
    const expiresAt = input.expiresInDays
      ? new Date(Date.parse(createdAt) + input.expiresInDays * 86_400_000).toISOString()
      : null;

    await getApiKeyStore().create({
      keyId: generated.keyId,
      displayPrefix: generated.displayPrefix,
      hash: generated.hash,
      name: input.name,
      scopes: input.scopes,
      tier: input.tier,
      maxIntentAmount: input.maxIntentAmount ?? null,
      createdAt,
      expiresAt,
      revokedAt: null,
      lastUsedAt: null,
    });

    // Never log `generated.key`.
    logger.info({
      event: 'api_key_created',
      keyId: generated.keyId,
      scopes: input.scopes,
      tier: input.tier,
    });

    return NextResponse.json(
      {
        key: generated.key,
        keyId: generated.keyId,
        displayPrefix: generated.displayPrefix,
        name: input.name,
        scopes: input.scopes,
        tier: input.tier,
        maxIntentAmount: input.maxIntentAmount ?? null,
        createdAt,
        expiresAt,
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  });
}

// ─── GET /api/admin/keys ──────────────────────────────────────────────────────
//
// Lists issued keys, newest first. Hashes are stripped.

export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.admin.keys.list', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.admin.keys',
      maxRequests: 30,
    });
    if (limited) return limited;

    if (!isAdminRequest(request)) {
      const throttled = await throttleFailedAdminAuth(request);
      if (throttled) return throttled;
      return forbidden();
    }

    const records = await getApiKeyStore().list();
    logger.info({ event: 'api_keys_listed', count: records.length });

    const redacted = records.map(({ hash: _hash, ...rest }) => rest);
    return NextResponse.json(redacted, { headers: { 'Cache-Control': 'no-store' } });
  });
}
