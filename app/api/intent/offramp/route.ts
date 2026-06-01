<<<<<<< HEAD
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
=======
import { NextResponse } from 'next/server'
import { registerIntentReplay } from '@/lib/intent/replay'

type IntentPayload = {
  account?: unknown
  nonce?: unknown
  deadline?: unknown
  intentHash?: unknown
}

type IntentReplayBody = {
  publicKey?: unknown
  account?: unknown
  nonce?: unknown
  deadline?: unknown
  intentHash?: unknown
  intent?: IntentPayload
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function pickValue(...values: unknown[]): string | null {
  for (const value of values) {
    const text = readString(value)
    if (text) return text
  }
  return null
}

function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ code, message }, { status })
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as IntentReplayBody | null

  if (!body || typeof body !== 'object') {
    return jsonError(400, 'invalid_request', 'Request body must be valid JSON.')
  }

  const publicKey = pickValue(body.publicKey, body.account, body.intent?.account)
  const nonce = pickValue(body.nonce, body.intent?.nonce)
  const deadline = pickValue(body.deadline, body.intent?.deadline)
  const intentHash = pickValue(body.intentHash, body.intent?.intentHash)

  if (!publicKey || !nonce || !deadline || !intentHash) {
    return jsonError(400, 'invalid_request', 'Expected publicKey, nonce, deadline, and intentHash.')
  }

  const result = registerIntentReplay({ publicKey, nonce, deadline })

  if (!result.ok) {
    return jsonError(result.status, result.code, result.message)
  }

  return NextResponse.json({ ok: true, intentHash }, { status: 200 })
}
>>>>>>> origin/main
