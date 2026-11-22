import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { POST as createRoute } from '@/app/api/recurring/route';
import { POST as executeRoute } from '@/app/api/recurring/[id]/executions/route';
import { hashStandingAuthorization } from '@/lib/recurring/authorization';
import { hashRecurringExecution } from '@/lib/recurring/execution';
import { resetStandingAuthorizationStore } from '@/lib/recurring/authorization-store';
import type {
  StandingAuthorizationTerms,
  RecurringExecutionIntent,
  SignedRecurringExecution,
} from '@/types/recurring';

describe('POST /api/recurring/[id]/executions (REC009)', () => {
  const kp = Keypair.random();

  beforeEach(() => {
    resetStandingAuthorizationStore();
  });

  async function setupAuth(overrides?: Partial<StandingAuthorizationTerms>): Promise<string> {
    const terms: StandingAuthorizationTerms = {
      type: 'recurring-authorization',
      version: 1,
      sender: kp.publicKey(),
      corridorId: 'usdc-ngn',
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      amount: '50',
      perPeriodCap: '100',
      period: 'daily',
      startDate: new Date(Date.now() - 60_000).toISOString(),
      anchorAllowlist: ['cowrie'],
      nonce: `n-${Date.now()}-${Math.random()}`,
      ...overrides,
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

  async function createSignedExecution(
    authId: string,
    overrides?: Partial<RecurringExecutionIntent>
  ): Promise<SignedRecurringExecution> {
    const intent: RecurringExecutionIntent = {
      type: 'recurring-execution',
      version: 1,
      authorizationId: authId,
      sender: kp.publicKey(),
      anchorId: 'cowrie',
      amount: '50',
      timestamp: Date.now(),
      nonce: `exec-nonce-${Date.now()}-${Math.random()}`,
      ...overrides,
    };
    const intentHash = await hashRecurringExecution(intent);
    const sigBytes = kp.sign(new TextEncoder().encode(intentHash));
    const signature = Buffer.from(sigBytes).toString('base64');
    return {
      intent,
      intentHash,
      signature,
      publicKey: kp.publicKey(),
    };
  }

  it('confirms execution with one valid signature and updates remaining cap', async () => {
    const authId = await setupAuth();
    const signedExec = await createSignedExecution(authId);

    const req = new NextRequest(`http://localhost:3000/api/recurring/${authId}/executions`, {
      method: 'POST',
      body: JSON.stringify(signedExec),
    });
    const res = await executeRoute(req, { params: Promise.resolve({ id: authId }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.execution.status).toBe('confirmed');
    expect(json.remainingCap).toBe('50');
  });

  it('returns idempotent 200 response on duplicate execution intentHash', async () => {
    const authId = await setupAuth();
    const signedExec = await createSignedExecution(authId);

    const req1 = new NextRequest(`http://localhost:3000/api/recurring/${authId}/executions`, {
      method: 'POST',
      body: JSON.stringify(signedExec),
    });
    const res1 = await executeRoute(req1, { params: Promise.resolve({ id: authId }) });
    expect(res1.status).toBe(201);

    const req2 = new NextRequest(`http://localhost:3000/api/recurring/${authId}/executions`, {
      method: 'POST',
      body: JSON.stringify(signedExec),
    });
    const res2 = await executeRoute(req2, { params: Promise.resolve({ id: authId }) });
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.idempotent).toBe(true);
  });

  it('rejects execution when anchor is not in allowlist', async () => {
    const authId = await setupAuth();
    const signedExec = await createSignedExecution(authId, { anchorId: 'not-allowed' });

    const req = new NextRequest(`http://localhost:3000/api/recurring/${authId}/executions`, {
      method: 'POST',
      body: JSON.stringify(signedExec),
    });
    const res = await executeRoute(req, { params: Promise.resolve({ id: authId }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('ANCHOR_NOT_ALLOWED');
    expect(json.execution.status).toBe('rejected');
  });

  it('rejects execution when period cap is exceeded', async () => {
    const authId = await setupAuth({ perPeriodCap: '60' });
    const signedExec1 = await createSignedExecution(authId, { amount: '50' });
    const req1 = new NextRequest(`http://localhost:3000/api/recurring/${authId}/executions`, {
      method: 'POST',
      body: JSON.stringify(signedExec1),
    });
    const res1 = await executeRoute(req1, { params: Promise.resolve({ id: authId }) });
    expect(res1.status).toBe(201);

    const signedExec2 = await createSignedExecution(authId, { amount: '50' });
    const req2 = new NextRequest(`http://localhost:3000/api/recurring/${authId}/executions`, {
      method: 'POST',
      body: JSON.stringify(signedExec2),
    });
    const res2 = await executeRoute(req2, { params: Promise.resolve({ id: authId }) });
    expect(res2.status).toBe(400);
    const json2 = await res2.json();
    expect(json2.code).toBe('CAP_EXCEEDED');
    expect(json2.execution.status).toBe('rejected');
  });
});
