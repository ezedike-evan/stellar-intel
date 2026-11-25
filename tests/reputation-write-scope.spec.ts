import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { flags } from '@/lib/flags';
import { POST as appendPOST } from '@/app/api/reputation/append/route';
import { POST as disputePOST } from '@/app/api/reputation/dispute/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import {
  InMemoryReputationStore,
  _setReputationStore,
  type ReputationStore,
} from '@/lib/reputation/store';
import { toOutcomeLogRow } from '@/lib/reputation/schema';
import { generateApiKey } from '@/lib/auth/api-keys';
import { InMemoryApiKeyStore, _setApiKeyStore } from '@/lib/auth/key-store';
import { _setWebhookEmitter } from '@/lib/webhooks/emit';

const HASH = 'a'.repeat(64);
const STELLAR_TX = 'b'.repeat(64);
const sender = Keypair.random();

function outcome(extra: Record<string, unknown> = {}) {
  return {
    intentHash: HASH,
    anchorId: 'cowrie',
    corridor: 'ngnt-ngn',
    quotedRate: '1500.0',
    quotedAmount: '100',
    outcome: 'completed' as const,
    stellarTransactionId: STELLAR_TX,
    publicKey: sender.publicKey(),
    signature: Buffer.from(sender.sign(Buffer.from(HASH, 'hex'))).toString('base64'),
    ...extra,
  };
}

function makeDisputeBody(intentHash: string, kp: Keypair) {
  const sig = Buffer.from(kp.sign(Buffer.from(intentHash, 'hex'))).toString('base64');
  return {
    intentHash,
    publicKey: kp.publicKey(),
    signature: sig,
    anchorId: 'moneygram',
    reason: 'Settlement failed to reach the destination account',
  };
}

describe('reputation:write scope gating on append and dispute (#2208)', () => {
  let repStore: ReputationStore;
  let keyStore: InMemoryApiKeyStore;
  const originalRequireKeyForWrites = flags.requireKeyForWrites;

  beforeEach(() => {
    flags.requireKeyForWrites = false;
    clearRateLimitStore();
    repStore = new InMemoryReputationStore();
    _setReputationStore(repStore);
    keyStore = new InMemoryApiKeyStore();
    _setApiKeyStore(keyStore);
    _setWebhookEmitter(() => {});
  });

  afterEach(async () => {
    flags.requireKeyForWrites = originalRequireKeyForWrites;
    _setWebhookEmitter(null);
    vi.restoreAllMocks();
    await repStore.close();
    _setReputationStore(null);
  });

  it('flag off: anonymous append with valid signature succeeds (201)', async () => {
    const req = new NextRequest('http://localhost/api/reputation/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(outcome()),
    });
    const res = await appendPOST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, intentHash: HASH, attested: true });
  });

  it('a key with only quotes:read gets 403 INSUFFICIENT_SCOPE on both routes, store is not touched', async () => {
    const key = await generateApiKey();
    await keyStore.create({
      keyId: key.keyId,
      displayPrefix: key.displayPrefix,
      hash: key.hash,
      name: 'Read-only key',
      scopes: ['quotes:read'],
      tier: 'standard',
      maxIntentAmount: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });

    const appendSpy = vi.spyOn(repStore, 'append');

    // Append route
    const appendReq = new NextRequest('http://localhost/api/reputation/append', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${key.key}`,
      },
      body: JSON.stringify(outcome()),
    });
    const appendRes = await appendPOST(appendReq);
    expect(appendRes.status).toBe(403);
    expect(appendRes.headers.get('WWW-Authenticate')).toBe(
      'Bearer error="insufficient_scope", scope="reputation:write"'
    );
    const appendJson = await appendRes.json();
    expect(appendJson.code).toBe('INSUFFICIENT_SCOPE');
    expect(appendSpy).not.toHaveBeenCalled();

    // Dispute route
    const disputeReq = new NextRequest('http://localhost/api/reputation/dispute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${key.key}`,
      },
      body: JSON.stringify(makeDisputeBody(HASH, sender)),
    });
    const disputeRes = await disputePOST(disputeReq);
    expect(disputeRes.status).toBe(403);
    expect(disputeRes.headers.get('WWW-Authenticate')).toBe(
      'Bearer error="insufficient_scope", scope="reputation:write"'
    );
    const disputeJson = await disputeRes.json();
    expect(disputeJson.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('flags.requireKeyForWrites = true: anonymous gets 403, key with reputation:write succeeds', async () => {
    flags.requireKeyForWrites = true;

    // Anonymous append gets 403
    const anonAppendReq = new NextRequest('http://localhost/api/reputation/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(outcome()),
    });
    const anonAppendRes = await appendPOST(anonAppendReq);
    expect(anonAppendRes.status).toBe(403);

    // Anonymous dispute gets 403
    const anonDisputeReq = new NextRequest('http://localhost/api/reputation/dispute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeDisputeBody(HASH, sender)),
    });
    const anonDisputeRes = await disputePOST(anonDisputeReq);
    expect(anonDisputeRes.status).toBe(403);

    // Key with reputation:write succeeds
    const key = await generateApiKey();
    await keyStore.create({
      keyId: key.keyId,
      displayPrefix: key.displayPrefix,
      hash: key.hash,
      name: 'Reputation write key',
      scopes: ['quotes:read', 'reputation:write'],
      tier: 'standard',
      maxIntentAmount: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });

    const keyedAppendReq = new NextRequest('http://localhost/api/reputation/append', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${key.key}`,
      },
      body: JSON.stringify(outcome()),
    });
    const keyedAppendRes = await appendPOST(keyedAppendReq);
    expect(keyedAppendRes.status).toBe(201);
  });

  it('an invalid key gives 401', async () => {
    const req = new NextRequest('http://localhost/api/reputation/append', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: 'Bearer invalid-api-key',
      },
      body: JSON.stringify(outcome()),
    });
    const res = await appendPOST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.code).toBe('UNAUTHORIZED');
  });
});
