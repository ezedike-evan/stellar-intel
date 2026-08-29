import type { NextRequest, NextResponse } from 'next/server';
import { withV1 } from '@/lib/api/v1';
import { IntentSchema, createOfframpIntent } from '@/lib/intent/offramp';
import { verifyOptionalIntentAttestation } from '@/lib/intent/verify';
import type { Intent } from '@/lib/intent/hash';

export const runtime = 'nodejs';

/**
 * POST /api/v1/intent/offramp — the public, hardened off-ramp intent surface.
 *
 * Returns the standard v1 error envelope, `X-RateLimit-*` headers on every
 * response, and honours `Idempotency-Key`: a retried request replays the
 * original response instead of building a second intent.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return withV1(
    request,
    { bucket: 'v1.intent.offramp', maxRequests: 20, idempotent: true },
    async (ctx) => {
      const body = await request.json().catch(() => null);

      const parsed = IntentSchema.safeParse(body);
      if (!parsed.success) {
        return ctx.error(
          'validation_error',
          parsed.error.issues[0]?.message ?? 'Invalid intent payload',
          400
        );
      }

      const intent = parsed.data as Intent;

      // Optional signature attestation — verified over the canonical intent hash
      // when supplied, unsigned intents still accepted (lib/intent/verify.ts).
      const attestation = await verifyOptionalIntentAttestation(body, intent);
      if (!attestation.ok) {
        return ctx.error(
          attestation.status === 401 ? 'unauthorized' : 'validation_error',
          attestation.message,
          attestation.status
        );
      }

      const result = await createOfframpIntent(intent);
      if (!result.ok) {
        return ctx.error(result.code.toLowerCase(), result.message, result.status);
      }

      return { status: 200, body: result.response };
    }
  );
}
