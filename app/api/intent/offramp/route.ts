import { NextRequest, NextResponse } from 'next/server';
import { SignedIntentEnvelopeSchema } from '@/types/intent';
import { verifyEnvelope } from '@/lib/intent/envelope';
import type { ApiError } from '@/types';

// ─── POST /api/intent/offramp ─────────────────────────────────────────────────

/**
 * Accepts a signed off-ramp intent envelope, verifies the Ed25519 signature,
 * then forwards the intent to the routing layer.
 *
 * Responses:
 *   200 — envelope accepted, intent queued for routing
 *   400 — malformed JSON or envelope fails Zod validation
 *   401 — signature verification failed
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiError>(
      { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' },
      { status: 400 }
    );
  }

  // ── Validate envelope shape ─────────────────────────────────────────────────
  const parsed = SignedIntentEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join('; ');
    return NextResponse.json<ApiError>({ code: 'INVALID_ENVELOPE', message }, { status: 400 });
  }

  // ── Verify signature ────────────────────────────────────────────────────────
  // verifyEnvelope re-canonicalizes the intent, re-hashes it, and checks the
  // Ed25519 signature. Returns false on any mismatch or bad key material.
  if (!verifyEnvelope(parsed.data)) {
    return NextResponse.json<ApiError>(
      { code: 'INVALID_SIGNATURE', message: 'Envelope signature verification failed.' },
      { status: 401 }
    );
  }

  // ── Route intent ────────────────────────────────────────────────────────────
  // Signature is valid — hand off to the off-ramp intent router.
  // TODO: invoke anchor-specific withdrawal flow via intent router.
  const { intent } = parsed.data;

  return NextResponse.json({ ok: true, intent }, { status: 200 });
}
