import type { NextRequest, NextResponse } from 'next/server';
import { withV1 } from '@/lib/api/v1';
import { IntentSchema, createOfframpIntent } from '@/lib/intent/offramp';
import { verifyOptionalIntentAttestation } from '@/lib/intent/verify';
import { registerIntentReplay } from '@/lib/intent/replay';
import { hashIntent, type Intent } from '@/lib/intent/hash';
import { emitWebhookEvent } from '@/lib/webhooks/emit';

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
    { bucket: 'v1.intent.offramp', maxRequests: 20, scope: 'intents:write', idempotent: true },
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
      const intentHash = await hashIntent(intent);

      // Optional signature attestation — verified over the canonical intent hash
      // when supplied, unsigned intents still accepted (lib/intent/verify.ts).
      const attestation = await verifyOptionalIntentAttestation(body, intent);
      if (!attestation.ok) {
        if (attestation.status === 401) {
          emitWebhookEvent(
            'intent.rejected',
            {
              intentHash,
              direction: 'offramp',
              reason: 'invalid_signature',
              sourceAsset: intent.sourceAsset,
              destinationAsset: intent.destinationAsset,
              amount: intent.amount,
            },
            { idempotencyKey: `intent.rejected:invalid_signature:${intentHash}` }
          );
        }
        return ctx.error(
          attestation.status === 401 ? 'unauthorized' : 'validation_error',
          attestation.message,
          attestation.status
        );
      }

      if (attestation.attested) {
        const { nonce, deadline } = intent as { nonce?: string; deadline?: string };
        if (!nonce || !deadline) {
          emitWebhookEvent(
            'intent.rejected',
            {
              intentHash,
              direction: 'offramp',
              reason: 'missing_replay_fields',
              sourceAsset: intent.sourceAsset,
              destinationAsset: intent.destinationAsset,
              amount: intent.amount,
            },
            { idempotencyKey: `intent.rejected:missing_replay_fields:${intentHash}` }
          );
          return ctx.error('validation_error', 'signed intents require nonce and deadline', 400);
        }

        const replay = await registerIntentReplay({
          publicKey: (body as { publicKey: string }).publicKey,
          nonce,
          deadline,
        });
        if (!replay.ok) {
          if (replay.code === 'replay_detected') {
            emitWebhookEvent(
              'intent.rejected',
              {
                intentHash,
                direction: 'offramp',
                reason: 'replay_detected',
                sourceAsset: intent.sourceAsset,
                destinationAsset: intent.destinationAsset,
                amount: intent.amount,
              },
              { idempotencyKey: `intent.rejected:replay_detected:${intentHash}` }
            );
          } else if (replay.code === 'deadline_expired') {
            emitWebhookEvent(
              'intent.expired',
              {
                intentHash,
                direction: 'offramp',
                deadline: String(intent.deadline),
                sourceAsset: intent.sourceAsset,
                destinationAsset: intent.destinationAsset,
                amount: intent.amount,
              },
              { idempotencyKey: `intent.expired:${intentHash}` }
            );
          }
          return ctx.error(replay.code, replay.message, replay.status);
        }
      }

      const result = await createOfframpIntent(intent);
      if (!result.ok) {
        if (result.code === 'NO_ROUTE') {
          emitWebhookEvent(
            'intent.rejected',
            {
              intentHash,
              direction: 'offramp',
              reason: 'no_route',
              sourceAsset: intent.sourceAsset,
              destinationAsset: intent.destinationAsset,
              amount: intent.amount,
            },
            { idempotencyKey: `intent.rejected:no_route:${intentHash}` }
          );
        }
        return ctx.error(result.code.toLowerCase(), result.message, result.status);
      }

      // Field by field, never a spread: the intent carries sender and recipient.
      // withV1 answers a replay from the cache before this handler runs.
      // The key is the quote id: one accepted intent has one quote, so the event for it
      // is the same event if this line is ever reached twice.
      emitWebhookEvent(
        'intent.created',
        {
          intentHash,
          direction: 'offramp',
          corridorId: result.response.route.corridorId,
          anchorId: result.response.route.anchorId,
          quoteId: result.response.quoteId,
          amount: intent.amount,
          sourceAsset: intent.sourceAsset,
          destinationAsset: intent.destinationAsset,
        },
        { idempotencyKey: `intent.created:${result.response.quoteId}` }
      );

      return {
        status: 200,
        body: result.response,
        auditIntentHash: result.response.quoteId,
      };
    }
  );
}
