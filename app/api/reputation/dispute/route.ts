import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Keypair } from '@stellar/stellar-sdk';
import type { ApiError } from '@/types';

const DisputeBodySchema = z.object({
  intentHash: z.string().regex(/^[0-9a-f]{64}$/, {
    message: 'intentHash must be a lowercase hex-encoded SHA-256 (64 chars)',
  }),
  publicKey: z.string().regex(/^G[A-Z0-9]{55}$/, {
    message: 'publicKey must be a valid Stellar public key (G…, 56 chars)',
  }),
  signature: z.string().min(1, { message: 'signature is required' }),
  anchorId: z.string().min(1, { message: 'anchorId is required' }),
  reason: z.string().min(1, { message: 'reason is required' }),
});

export type DisputeBody = z.infer<typeof DisputeBodySchema>;

export interface DisputeRecord {
  id: string;
  intentHash: string;
  publicKey: string;
  anchorId: string;
  reason: string;
  disputed: true;
  createdAt: string;
}

// ─── In-memory stores (replace with DB for production) ───────────────────────

const disputes = new Map<string, DisputeRecord>();

interface RateLimitEntry {
  count: number;
  windowStart: number;
}
const rateLimitStore = new Map<string, RateLimitEntry>();

const DISPUTE_WINDOW_MS = 86_400_000; // 24 hours
const DISPUTE_MAX = 10;

function checkDisputeRateLimit(publicKey: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(publicKey);

  if (!entry || now - entry.windowStart >= DISPUTE_WINDOW_MS) {
    rateLimitStore.set(publicKey, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= DISPUTE_MAX) return false;
  entry.count += 1;
  return true;
}

export function clearDisputeStores(): void {
  disputes.clear();
  rateLimitStore.clear();
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ApiError>(
      { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
      { status: 400 }
    );
  }

  const parsed = DisputeBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiError>(
      { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Validation failed' },
      { status: 422 }
    );
  }

  const { intentHash, publicKey, signature, anchorId, reason } = parsed.data;

  // Verify Ed25519 proof: signature over the raw intentHash bytes
  let valid = false;
  try {
    const keypair = Keypair.fromPublicKey(publicKey);
    const messageBytes = Buffer.from(intentHash, 'hex');
    const sigBytes = Buffer.from(signature, 'base64');
    valid = keypair.verify(messageBytes, sigBytes);
  } catch {
    valid = false;
  }

  if (!valid) {
    return NextResponse.json<ApiError>(
      { code: 'FORBIDDEN', message: 'Signature verification failed' },
      { status: 403 }
    );
  }

  if (!checkDisputeRateLimit(publicKey)) {
    return NextResponse.json<ApiError>(
      { code: 'RATE_LIMITED', message: 'Dispute limit of 10 per 24 h exceeded' },
      { status: 429 }
    );
  }

  const record: DisputeRecord = {
    id: `${publicKey.slice(0, 8)}-${intentHash.slice(0, 8)}-${Date.now()}`,
    intentHash,
    publicKey,
    anchorId,
    reason,
    disputed: true,
    createdAt: new Date().toISOString(),
  };
  disputes.set(record.id, record);

  return NextResponse.json(record, { status: 201 });
}
