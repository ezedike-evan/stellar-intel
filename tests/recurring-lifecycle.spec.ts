import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { VISIBLE_CORRIDORS, ANCHORS } from '@/constants/anchors';
import { POST as createRoute } from '@/app/api/recurring/route';
import { GET as getRoute } from '@/app/api/recurring/[id]/route';
import { GET as dueRoute } from '@/app/api/recurring/due/route';
import { POST as controlRoute } from '@/app/api/recurring/[id]/control/route';
import { POST as executeRoute } from '@/app/api/recurring/[id]/executions/route';
import { hashStandingAuthorization } from '@/lib/recurring/authorization';
import { hashRecurringExecution } from '@/lib/recurring/execution';
import { resetStandingAuthorizationStore } from '@/lib/recurring/authorization-store';
import type {
  StandingAuthorizationTerms,
  SignedStandingAuthorization,
  RecurringExecutionIntent,
  SignedRecurringExecution,
} from '@/types/recurring';

describe('Standing Order Full Lifecycle across VISIBLE_CORRIDORS (REC013)', () => {
  const kp = Keypair.random();

  beforeEach(() => {
    resetStandingAuthorizationStore();
  });

  async function createAuthorization(corridorId: string, anchorId: string, ipIndex = 1): Promise<string> {
    const terms: StandingAuthorizationTerms = {
      type: 'recurring-authorization',
      version: 1,
      sender: kp.publicKey(),
      corridorId,
      sourceAsset: 'USDC',
      destinationAsset: corridorId.split('-')[1]?.toUpperCase() ?? 'FIAT',
      amount: '50',
      perPeriodCap: '100',
      period: 'daily',
      startDate: new Date(Date.now() - 60_000).toISOString(),
      stopDate: new Date(Date.now() + 86_400_000 * 30).toISOString(),
      anchorAllowlist: [anchorId],
      nonce: `n-${corridorId}-${Date.now()}-${Math.random()}`,
    };
    const termsHash = await hashStandingAuthorization(terms);
    const sigBytes = kp.sign(new TextEncoder().encode(termsHash));
    const signature = Buffer.from(sigBytes).toString('base64');
    const signed: SignedStandingAuthorization = {
      terms,
      termsHash,
      signature,
      publicKey: kp.publicKey(),
    };

    const req = new NextRequest('http://localhost:3000/api/recurring', {
      method: 'POST',
      headers: { 'x-forwarded-for': `192.168.10.${ipIndex}` },
      body: JSON.stringify(signed),
    });
    const res = await createRoute(req);
    expect(res.status).toBe(201);
    return termsHash;
  }

  async function executeStandingOrder(
    authId: string,
    anchorId: string,
    amount: string,
    ipIndex = 1
  ): Promise<{ status: number; body: any }> {
    const intent: RecurringExecutionIntent = {
      type: 'recurring-execution',
      version: 1,
      authorizationId: authId,
      sender: kp.publicKey(),
      anchorId,
      amount,
      timestamp: Date.now(),
      nonce: `exec-${Date.now()}-${Math.random()}`,
    };
    const intentHash = await hashRecurringExecution(intent);
    const sigBytes = kp.sign(new TextEncoder().encode(intentHash));
    const signature = Buffer.from(sigBytes).toString('base64');
    const signedExec: SignedRecurringExecution = {
      intent,
      intentHash,
      signature,
      publicKey: kp.publicKey(),
    };

    const req = new NextRequest(`http://localhost:3000/api/recurring/${authId}/executions`, {
      method: 'POST',
      headers: { 'x-forwarded-for': `192.168.10.${ipIndex}` },
      body: JSON.stringify(signedExec),
    });
    const res = await executeRoute(req, { params: Promise.resolve({ id: authId }) });
    const body = await res.json();
    return { status: res.status, body };
  }

  function signControl(authId: string, action: string, timestamp: number, nonce: string): string {
    const text = `${authId}:${action}:${timestamp}:${nonce}`;
    return Buffer.from(kp.sign(new TextEncoder().encode(text))).toString('base64');
  }

  describe.each(VISIBLE_CORRIDORS.map((c, idx) => ({ ...c, ipIndex: idx + 1 })))('Corridor: $id', (corridor) => {
    const anchorId = ANCHORS.find((a) => a.corridors.includes(corridor.id))?.id || 'moneygram';

    it('runs the full lifecycle: create -> due -> confirm -> cap breach -> pause -> resume -> cancel', async () => {
      // 1. Create authorization
      const authId = await createAuthorization(corridor.id, anchorId, corridor.ipIndex);

      // 2. Read authorization
      const getReq = new NextRequest(`http://localhost:3000/api/recurring/${authId}`);
      const getRes = await getRoute(getReq, { params: Promise.resolve({ id: authId }) });
      expect(getRes.status).toBe(200);

      // 3. Query due route
      const dueReq = new NextRequest(`http://localhost:3000/api/recurring/due?ids=${authId}`);
      const dueRes = await dueRoute(dueReq);
      expect(dueRes.status).toBe(200);
      const dueJson = await dueRes.json();
      expect(dueJson.reminders[0].due).toBe(true);

      // 4. Confirm execution 1
      const exec1 = await executeStandingOrder(authId, anchorId, '50', corridor.ipIndex);
      expect(exec1.status).toBe(201);
      expect(exec1.body.execution.status).toBe('confirmed');
      expect(exec1.body.remainingCap).toBe('50');

      // 5. Confirm execution 2 (exhausts period cap)
      const exec2 = await executeStandingOrder(authId, anchorId, '50', corridor.ipIndex);
      expect(exec2.status).toBe(201);
      expect(exec2.body.remainingCap).toBe('0');

      // 6. Execution 3 breaches cap
      const exec3 = await executeStandingOrder(authId, anchorId, '50', corridor.ipIndex);
      expect(exec3.status).toBe(400);
      expect(exec3.body.code).toBe('CAP_EXCEEDED');

      // 7. Non-allowlisted anchor rejected
      const execNonAllow = await executeStandingOrder(authId, 'unknown-anchor', '50', corridor.ipIndex);
      expect(execNonAllow.status).toBe(400);
      expect(execNonAllow.body.code).toBe('ANCHOR_NOT_ALLOWED');

      // 8. Pause
      const now = Date.now();
      const pauseSig = signControl(authId, 'pause', now, 'nonce-pause');
      const pauseReq = new NextRequest(`http://localhost:3000/api/recurring/${authId}/control`, {
        method: 'POST',
        body: JSON.stringify({ action: 'pause', timestamp: now, nonce: 'nonce-pause', signature: pauseSig }),
      });
      const pauseRes = await controlRoute(pauseReq, { params: Promise.resolve({ id: authId }) });
      expect(pauseRes.status).toBe(200);

      // 9. Executions fail while paused
      const execPaused = await executeStandingOrder(authId, anchorId, '10');
      expect(execPaused.status).toBe(400);

      // 10. Resume
      const resumeSig = signControl(authId, 'resume', now + 10, 'nonce-resume');
      const resumeReq = new NextRequest(`http://localhost:3000/api/recurring/${authId}/control`, {
        method: 'POST',
        body: JSON.stringify({ action: 'resume', timestamp: now + 10, nonce: 'nonce-resume', signature: resumeSig }),
      });
      const resumeRes = await controlRoute(resumeReq, { params: Promise.resolve({ id: authId }) });
      expect(resumeRes.status).toBe(200);

      // 11. Cancel
      const cancelSig = signControl(authId, 'cancel', now + 20, 'nonce-cancel');
      const cancelReq = new NextRequest(`http://localhost:3000/api/recurring/${authId}/control`, {
        method: 'POST',
        body: JSON.stringify({ action: 'cancel', timestamp: now + 20, nonce: 'nonce-cancel', signature: cancelSig }),
      });
      const cancelRes = await controlRoute(cancelReq, { params: Promise.resolve({ id: authId }) });
      expect(cancelRes.status).toBe(200);
    });
  });
});
