import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { POST as appendPOST } from '@/app/api/reputation/append/route';
import { InMemoryReputationStore, _setReputationStore } from '@/lib/reputation/store';

let store: InMemoryReputationStore;

beforeEach(() => {
  store = new InMemoryReputationStore();
  _setReputationStore(store);
});

afterEach(() => {
  vi.restoreAllMocks();
  _setReputationStore(null);
});

const HASH = 'a'.repeat(64);

function base(extra: Record<string, unknown> = {}) {
  return {
    intentHash: HASH,
    anchorId: 'cowrie',
    corridor: 'USDC-NGN',
    quotedRate: '1500.0',
    quotedAmount: '100',
    outcome: 'completed' as const,
    ...extra,
  };
}

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/reputation/append', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/reputation/append — optional attestation', () => {
  it('accepts and marks attested when the signature is valid', async () => {
    const kp = Keypair.random();
    const signature = kp.sign(Buffer.from(HASH, 'hex')).toString('base64');
    const res = await appendPOST(req(base({ signature, publicKey: kp.publicKey() })));
    expect(res.status).toBe(201);
    expect((await res.json()).attested).toBe(true);
    expect(await store.query({})).toHaveLength(1);
  });

  it('rejects a forged (wrong-key) signature with 403 and writes nothing', async () => {
    const claimed = Keypair.random();
    const forged = Keypair.random().sign(Buffer.from(HASH, 'hex')).toString('base64');
    const res = await appendPOST(req(base({ signature: forged, publicKey: claimed.publicKey() })));
    expect(res.status).toBe(403);
    expect(await store.query({})).toHaveLength(0);
  });

  it('accepts an unsigned row as unattested telemetry (non-breaking)', async () => {
    const res = await appendPOST(req(base()));
    expect(res.status).toBe(201);
    expect((await res.json()).attested).toBe(false);
  });

  it('rejects only one of signature/publicKey with 400', async () => {
    const res = await appendPOST(req(base({ signature: 'lonely-sig' })));
    expect(res.status).toBe(400);
  });
});
