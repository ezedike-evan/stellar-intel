import type { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withV1 } from '@/lib/api/v1';
import { API_SCOPES, hasScope } from '@/lib/auth/api-keys';
import { getTokenSecret, MAX_TOKEN_TTL_SECONDS, signCallerToken } from '@/lib/auth/token';

export const runtime = 'nodejs';

const MIN_EXCHANGE_TTL_SECONDS = 60;

const TokenExchangeSchema = z.object({
  scopes: z
    .array(z.enum(API_SCOPES))
    .nonempty()
    .refine((scopes) => new Set(scopes).size === scopes.length, {
      message: 'scopes must be unique',
    })
    .optional(),
  ttlSeconds: z
    .number()
    .int()
    .min(MIN_EXCHANGE_TTL_SECONDS)
    .max(MAX_TOKEN_TTL_SECONDS)
    .default(MAX_TOKEN_TTL_SECONDS),
});

/**
 * POST /api/v1/auth/token — exchange a long-lived API key for a short-lived
 * token carrying a subset of the key's scopes, to hand to an agent.
 *
 * Only a key can mint: a token cannot mint another token, so there are no
 * refresh chains and a leaked token dies at its `exp`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return withV1(
    request,
    // scope: null — the handler authorizes: any key may mint a token for its own scopes.
    { bucket: 'v1.auth.token', maxRequests: 10, scope: null },
    async (ctx) => {
      const { caller } = ctx;
      if (caller.kind !== 'key' || !caller.keyId) {
        return ctx.error(
          'api_key_required',
          'Exchange requires an API key, not a token or anonymous call',
          401
        );
      }

      const secret = getTokenSecret();
      if (!secret) {
        return ctx.error(
          'tokens_unavailable',
          'Caller tokens are not enabled on this deployment',
          503
        );
      }

      const raw = await request.text();
      let body: unknown = {};
      if (raw.trim() !== '') {
        try {
          body = JSON.parse(raw);
        } catch {
          return ctx.error('validation_error', 'Request body must be valid JSON', 400);
        }
      }

      const parsed = TokenExchangeSchema.safeParse(body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path[0] !== undefined ? `${String(issue.path[0])}: ` : '';
        return ctx.error(
          'validation_error',
          `${field}${issue?.message ?? 'Invalid token request'}`,
          400
        );
      }

      const scopes = parsed.data.scopes ? [...parsed.data.scopes] : [...caller.scopes];
      const missing = scopes.find((scope) => !hasScope(caller.scopes, scope));
      if (missing) {
        return ctx.error(
          'insufficient_scope',
          `This key does not hold the "${missing}" scope`,
          403
        );
      }

      const { ttlSeconds } = parsed.data;
      const now = Date.now();
      const token = await signCallerToken({ keyId: caller.keyId, scopes, ttlSeconds }, secret, now);
      const expiresAt = new Date((Math.floor(now / 1000) + ttlSeconds) * 1000).toISOString();

      return {
        status: 200,
        body: {
          token,
          tokenType: 'Bearer',
          expiresIn: ttlSeconds,
          expiresAt,
          scopes,
          tier: caller.tier,
        },
        headers: { 'Cache-Control': 'no-store' },
      };
    }
  );
}
