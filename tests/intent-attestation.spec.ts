import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { verifyOptionalIntentAttestation } from '@/lib/intent/verify';
import { hashIntent, type Intent } from '@/lib/intent/hash';
import { POST as offrampPOST } from '@/app/api/intent/offramp/route';

const intent: Intent = {
  type: 'offramp',
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '100',
  sender: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  recipient: '0800-123-456',
};

async function signIntent(kp: Keypair): Promise<string> {
  const hash = await hashIntent(intent);
  return Buffer.from(kp.sign(Buffer.from(hash, 'hex'))).toString('base64');
}

describe('verifyOptionalIntentAttestation', () => {
  it('passes attested=false when no envelope is supplied', async () => {
    expect(await verifyOptionalIntentAttestation({}, intent)).toEqual({
      ok: true,
      attested: false,
    });
  });

  it('passes attested=true for a valid signature', async () => {
    const kp = Keypair.random();
    const signature = await signIntent(kp);
    const res = await verifyOptionalIntentAttestation(
      { signature, publicKey: kp.publicKey() },
      intent
    );
    expect(res).toEqual({ ok: true, attested: true });
  });

  it('rejects a forged signature with 401', async () => {
    const claimed = Keypair.random();
    const forged = await signIntent(Keypair.random());
    const res = await verifyOptionalIntentAttestation(
      { signature: forged, publicKey: claimed.publicKey() },
      intent
    );
    expect(res).toEqual({ ok: false, status: 401, message: expect.any(String) });
  });

  it('rejects only one of signature/publicKey with 400', async () => {
    const res = await verifyOptionalIntentAttestation({ signature: 'x' }, intent);
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ status: 400 });
  });
});

describe('POST /api/intent/offramp — attestation wiring', () => {
  it('returns 401 when a supplied signature does not verify', async () => {
    const claimed = Keypair.random();
    const forged = await signIntent(Keypair.random());
    const req = new NextRequest('http://localhost/api/intent/offramp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...intent, signature: forged, publicKey: claimed.publicKey() }),
    });
    const res = await offrampPOST(req);
    expect(res.status).toBe(401);
  });
});
