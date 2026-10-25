import type { NextRequest, NextResponse } from 'next/server';
import { withV1 } from '@/lib/api/v1';
import { createOnrampIntent } from '@/lib/intent/onramp';
import { OnrampIntentSchema } from '@/lib/intent/onramp-schema';
import { verifyOptionalIntentAttestation } from '@/lib/intent/verify';

export const runtime = 'nodejs';

/**
 * POST /api/v1/intent/onramp — the public on-ramp (deposit) intent surface.
 *
 * Routes the intent to the best indicative anchor and returns the handoff URL
 * into /onramp, plus an unsigned changeTrust XDR when the destination has no
 * trustline. No anchor session is opened here: KYC and the interactive deposit
 * are browser-only. Honours `Idempotency-Key` like the off-ramp route.
 *
 * Unlike the off-ramp there is no nonce/deadline replay registry: this call
 * moves no funds and changes no server state, so replaying it is harmless and
 * the idempotency key already collapses client retries.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return withV1(
    request,
    { bucket: 'v1.intent.onramp', maxRequests: 20, idempotent: true },
    async (ctx) => {
      const body = await request.json().catch(() => null);

      const parsed = OnrampIntentSchema.safeParse(body);
      if (!parsed.success) {
        return ctx.error(
          'validation_error',
          parsed.error.issues[0]?.message ?? 'Invalid intent payload',
          400
        );
      }
      const intent = parsed.data;

      // Optional signature attestation over the canonical intent hash.
      const attestation = await verifyOptionalIntentAttestation(body, intent);
      if (!attestation.ok) {
        return ctx.error(
          attestation.status === 401 ? 'unauthorized' : 'validation_error',
          attestation.message,
          attestation.status
        );
      }

      const result = await createOnrampIntent(intent);
      if (!result.ok) {
        return ctx.error(result.code.toLowerCase(), result.message, result.status);
      }

      return { status: 200, body: result.response };
    }
  );
}
