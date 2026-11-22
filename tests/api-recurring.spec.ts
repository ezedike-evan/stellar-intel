import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { POST as createRoute } from '@/app/api/recurring/route';
import { GET as getRoute } from '@/app/api/recurring/[id]/route';
import { GET as dueRoute } from '@/app/api/recurring/due/route';
import { hashStandingAuthorization } from '@/lib/recurring/authorization';
import { resetStandingAuthorizationStore } from '@/lib/recurring/authorization-store';
import type { StandingAuthorizationTerms, SignedStandingAuthorization } from '@/types/recurring';

describe('/api/recurring routes', () => {
  const kp = Keypair.random();

  beforeEach(() => {
    resetStandingAuthorizationStore();
  });

  async function createSigned(overrides?: Partial<StandingAuthorizationTerms>): Promise<SignedStandingAuthorization> {
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
      nonce: `nonce-${Date.now()}-${Math.random()}`,
      ...overrides,
    };
    const termsHash = await hashStandingAuthorization(terms);
    const sigBytes = kp.sign(new TextEncoder().encode(termsHash));
    const signature = Buffer.from(sigBytes).toString('base64');
    return { terms, termsHash, signature, publicKey: kp.publicKey() };
  }

  it('POST /api/recurring creates a valid standing authorization', async () => {
    const signed = await createSigned();
    const req = new NextRequest('http://localhost:3000/api/recurring', {
      method: 'POST',
      body: JSON.stringify(signed),
    });
    const res = await createRoute(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.authorization.termsHash).toBe(signed.termsHash);
  });

  it('GET /api/recurring/[id] fetches created authorization', async () => {
    const signed = await createSigned();
    const createReq = new NextRequest('http://localhost:3000/api/recurring', {
      method: 'POST',
      body: JSON.stringify(signed),
    });
    await createRoute(createReq);

    const getReq = new NextRequest(`http://localhost:3000/api/recurring/${signed.termsHash}`);
    const res = await getRoute(getReq, { params: Promise.resolve({ id: signed.termsHash }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.authorization.termsHash).toBe(signed.termsHash);
    expect(json.reminder).toBeDefined();
  });

  it('GET /api/recurring/due queries batch due reminders', async () => {
    const signed = await createSigned();
    const createReq = new NextRequest('http://localhost:3000/api/recurring', {
      method: 'POST',
      body: JSON.stringify(signed),
    });
    await createRoute(createReq);

    const queryReq = new NextRequest(
      `http://localhost:3000/api/recurring/due?ids=${signed.termsHash}`
    );
    const res = await dueRoute(queryReq);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reminders.length).toBe(1);
    expect(json.reminders[0].authorizationId).toBe(signed.termsHash);
  });
});
