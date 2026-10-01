import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { randomBytes, randomUUID } from 'crypto';
import { hashIntent, type Intent } from '@/lib/intent/hash';
import { clearIntentReplayStore } from '@/lib/intent/replay';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { clearIdempotencyStore } from '@/lib/api/idempotency';
import { POST as internalPOST } from '@/app/api/intent/offramp/route';
import { POST as v1POST } from '@/app/api/v1/intent/offramp/route';

// Routing is configuration-driven; without this every corridor is unroutable (#941).
const TEST_ANCHOR_ACCOUNTS = JSON.stringify({
  cowrie: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  moneygram: 'GAZW2PQFFJGH7RH6PB5VQASJIRAGEMZCID72CXYHRM27QYP4R5YRY777',
});

function baseIntent(overrides: Partial<Intent> = {}): Intent {
  return {
    type: 'offramp',
    sourceAsset: 'USDC',
    destinationAsset: 'NGN',
    amount: '100',
    sender: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    recipient: '0800-123-456',
    ...overrides,
  };
}

function nonce(): string {
  return randomBytes(16).toString('hex');
}

async function signedBody(intent: Intent, kp: Keypair): Promise<Record<string, unknown>> {
  const hash = await hashIntent(intent);
  const signature = Buffer.from(kp.sign(Buffer.from(hash, 'hex'))).toString('base64');
  return { ...intent, signature, publicKey: kp.publicKey() };
}

function req(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  clearIntentReplayStore();
  clearRateLimitStore();
  clearIdempotencyStore();
  vi.unstubAllEnvs();
  vi.stubEnv('ANCHOR_PAYMENT_ACCOUNTS', TEST_ANCHOR_ACCOUNTS);
});

afterEach(() => {
  clearIntentReplayStore();
  vi.unstubAllEnvs();
});

describe.each([
  {
    name: 'internal /api/intent/offramp',
    post: internalPOST,
    url: 'http://localhost/api/intent/offramp',
  },
  {
    name: 'v1 /api/v1/intent/offramp',
    post: v1POST,
    url: 'http://localhost/api/v1/intent/offramp',
  },
])('$name — replay protection', ({ post, url }) => {
  it('accepts a signed intent with nonce and deadline', async () => {
    const kp = Keypair.random();
    const deadline = new Date(Date.now() + 60_000).toISOString();
    const intent = baseIntent({ nonce: nonce(), deadline });
    const res = await post(req(url, await signedBody(intent, kp)));
    expect(res.status).toBe(200);
  });

  it('rejects a resubmitted nonce with 409', async () => {
    const kp = Keypair.random();
    const deadline = new Date(Date.now() + 60_000).toISOString();
    const intent = baseIntent({ nonce: nonce(), deadline });
    const body = await signedBody(intent, kp);

    const first = await post(req(url, body));
    expect(first.status).toBe(200);

    // Same body, fresh idempotency key so it is not just an idempotent replay.
    const second = await post(
      new NextRequest(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
        body: JSON.stringify(body),
      })
    );
    expect(second.status).toBe(409);
  });

  it('rejects a past deadline with 410', async () => {
    const kp = Keypair.random();
    const deadline = new Date(Date.now() - 60_000).toISOString();
    const intent = baseIntent({ nonce: nonce(), deadline });
    const res = await post(req(url, await signedBody(intent, kp)));
    expect(res.status).toBe(410);
  });

  it('rejects a signed intent missing a nonce with 400', async () => {
    const kp = Keypair.random();
    const deadline = new Date(Date.now() + 60_000).toISOString();
    const intent = baseIntent({ deadline });
    const res = await post(req(url, await signedBody(intent, kp)));
    expect(res.status).toBe(400);
  });

  it('accepts an unsigned intent without a nonce', async () => {
    const intent = baseIntent();
    const res = await post(req(url, intent));
    expect(res.status).toBe(200);
  });
});
