import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { POST as controlRoute } from '@/app/api/recurring/[id]/control/route';
import { POST as createRoute } from '@/app/api/recurring/route';
import { hashStandingAuthorization } from '@/lib/recurring/authorization';
import { resetStandingAuthorizationStore } from '@/lib/recurring/authorization-store';
import type { StandingAuthorizationTerms } from '@/types/recurring';

describe('POST /api/recurring/[id]/control', () => {
  const kp = Keypair.random();

  beforeEach(() => {
    resetStandingAuthorizationStore();
  });

  async function setupAuth(): Promise<string> {
    const terms: StandingAuthorizationTerms = {
      type: 'recurring-authorization',
      version: 1,
      sender: kp.publicKey(),
      corridorId: 'usdc-ngn',
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      amount: '50',
      perPeriodCap: '200',
      period: 'daily',
      startDate: new Date().toISOString(),
      anchorAllowlist: ['cowrie'],
      nonce: `n-${Date.now()}-${Math.random()}`,
    };
    const termsHash = await hashStandingAuthorization(terms);
    const sigBytes = kp.sign(new TextEncoder().encode(termsHash));
    const signature = Buffer.from(sigBytes).toString('base64');
    const req = new NextRequest('http://localhost:3000/api/recurring', {
      method: 'POST',
      body: JSON.stringify({ terms, termsHash, signature, publicKey: kp.publicKey() }),
    });
    await createRoute(req);
    return termsHash;
  }

  function signControl(authId: string, action: string, timestamp: number, nonce: string): string {
    const text = `${authId}:${action}:${timestamp}:${nonce}`;
    return Buffer.from(kp.sign(new TextEncoder().encode(text))).toString('base64');
  }

  it('pauses and resumes standing order with valid signatures', async () => {
    const authId = await setupAuth();
    const now = Date.now();
    const nonce1 = 'ctrl-1';
    const sig1 = signControl(authId, 'pause', now, nonce1);

    const pauseReq = new NextRequest(`http://localhost:3000/api/recurring/${authId}/control`, {
      method: 'POST',
      body: JSON.stringify({ action: 'pause', timestamp: now, nonce: nonce1, signature: sig1 }),
    });
    const pauseRes = await controlRoute(pauseReq, { params: Promise.resolve({ id: authId }) });
    expect(pauseRes.status).toBe(200);
    const pauseJson = await pauseRes.json();
    expect(pauseJson.authorization.status).toBe('paused');

    const nonce2 = 'ctrl-2';
    const sig2 = signControl(authId, 'resume', now + 10, nonce2);
    const resumeReq = new NextRequest(`http://localhost:3000/api/recurring/${authId}/control`, {
      method: 'POST',
      body: JSON.stringify({ action: 'resume', timestamp: now + 10, nonce: nonce2, signature: sig2 }),
    });
    const resumeRes = await controlRoute(resumeReq, { params: Promise.resolve({ id: authId }) });
    expect(resumeRes.status).toBe(200);
    const resumeJson = await resumeRes.json();
    expect(resumeJson.authorization.status).toBe('active');
  });

  it('cancels standing order and forbids subsequent controls', async () => {
    const authId = await setupAuth();
    const now = Date.now();
    const nonce = 'ctrl-cancel';
    const sig = signControl(authId, 'cancel', now, nonce);

    const cancelReq = new NextRequest(`http://localhost:3000/api/recurring/${authId}/control`, {
      method: 'POST',
      body: JSON.stringify({ action: 'cancel', timestamp: now, nonce, signature: sig }),
    });
    const cancelRes = await controlRoute(cancelReq, { params: Promise.resolve({ id: authId }) });
    expect(cancelRes.status).toBe(200);

    const sig2 = signControl(authId, 'pause', now + 10, 'ctrl-after-cancel');
    const pauseReq = new NextRequest(`http://localhost:3000/api/recurring/${authId}/control`, {
      method: 'POST',
      body: JSON.stringify({ action: 'pause', timestamp: now + 10, nonce: 'ctrl-after-cancel', signature: sig2 }),
    });
    const afterRes = await controlRoute(pauseReq, { params: Promise.resolve({ id: authId }) });
    expect(afterRes.status).toBe(400);
  });
});
