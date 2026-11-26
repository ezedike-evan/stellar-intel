import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { randomBytes, randomUUID } from 'crypto';
import { flags } from '@/lib/flags';
import { hashIntent } from '@/lib/intent/hash';
import { clearIntentReplayStore } from '@/lib/intent/replay';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import {
  getStandingAuthorizationStore,
  _setStandingAuthorizationStore,
  type StandingAuthorizationRecord,
} from '@/lib/recurring/authorization-store';
import { applyControlAction, type RecurringControl } from '@/lib/recurring/control';
import type { StandingAuthorizationTerms } from '@/types/recurring';
import { POST } from '@/app/api/recurring/[id]/control/route';

describe('applyControlAction unit tests', () => {
  it('allows active -> paused on pause', () => {
    expect(applyControlAction('active', 'pause')).toEqual({ ok: true, status: 'paused' });
  });

  it('allows paused -> active on resume', () => {
    expect(applyControlAction('paused', 'resume')).toEqual({ ok: true, status: 'active' });
  });

  it('allows active -> cancelled on cancel', () => {
    expect(applyControlAction('active', 'cancel')).toEqual({ ok: true, status: 'cancelled' });
  });

  it('allows paused -> cancelled on cancel', () => {
    expect(applyControlAction('paused', 'cancel')).toEqual({ ok: true, status: 'cancelled' });
  });

  it('rejects invalid transitions', () => {
    expect(applyControlAction('cancelled', 'resume')).toEqual({
      ok: false,
      code: 'invalid_transition',
    });
    expect(applyControlAction('cancelled', 'pause')).toEqual({
      ok: false,
      code: 'invalid_transition',
    });
    expect(applyControlAction('cancelled', 'cancel')).toEqual({
      ok: false,
      code: 'invalid_transition',
    });
    expect(applyControlAction('active', 'resume')).toEqual({
      ok: false,
      code: 'invalid_transition',
    });
    expect(applyControlAction('paused', 'pause')).toEqual({
      ok: false,
      code: 'invalid_transition',
    });
  });
});

describe('POST /api/recurring/[id]/control', () => {
  let senderKp: Keypair;
  let otherKp: Keypair;
  let authId: string;
  let baseTerms: StandingAuthorizationTerms;
  let prevFlag: boolean;

  function makeControl(
    action: 'pause' | 'resume' | 'cancel',
    overrides: Partial<RecurringControl> = {}
  ): RecurringControl {
    return {
      type: 'recurring-control',
      action,
      authorizationId: authId,
      sender: senderKp.publicKey(),
      sourceAsset: baseTerms.sourceAsset,
      destinationAsset: baseTerms.destinationAsset,
      amount: baseTerms.amount,
      nonce: randomBytes(16).toString('hex'),
      deadline: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    };
  }

  async function signedPayload(
    control: RecurringControl,
    signer: Keypair = senderKp,
    publicKeyOverride?: string
  ) {
    const hash = await hashIntent(control);
    const signature = Buffer.from(signer.sign(Buffer.from(hash, 'hex'))).toString('base64');
    return {
      control,
      signature,
      publicKey: publicKeyOverride ?? signer.publicKey(),
    };
  }

  function makeRequest(id: string, body: unknown): NextRequest {
    return new NextRequest(`http://localhost/api/recurring/${id}/control`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  beforeEach(async () => {
    prevFlag = flags.recurringIntents;
    flags.recurringIntents = true;
    clearIntentReplayStore();
    clearRateLimitStore();
    _setStandingAuthorizationStore(null);

    senderKp = Keypair.random();
    otherKp = Keypair.random();
    authId = randomUUID();

    baseTerms = {
      type: 'recurring-authorization',
      version: 1,
      sender: senderKp.publicKey(),
      corridorId: 'usdc-ngn',
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      amount: '100',
      perPeriodCap: '500',
      period: 'monthly',
      startAt: '2026-01-01T00:00:00.000Z',
      stopAt: '2026-12-31T23:59:59.000Z',
      anchorAllowlist: ['cowrie'],
      nonce: randomBytes(16).toString('hex'),
    };

    const termsHash = await hashIntent(baseTerms as any);
    const sig = Buffer.from(senderKp.sign(Buffer.from(termsHash, 'hex'))).toString('base64');

    const record: StandingAuthorizationRecord = {
      id: authId,
      termsHash,
      authorization: {
        terms: baseTerms,
        termsHash,
        signature: sig,
        publicKey: senderKp.publicKey(),
      },
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const store = getStandingAuthorizationStore();
    await store.create(record);
  });

  afterEach(() => {
    flags.recurringIntents = prevFlag;
    clearIntentReplayStore();
    clearRateLimitStore();
    _setStandingAuthorizationStore(null);
    vi.useRealTimers();
  });

  it('pause, then resume, then cancel happy path', async () => {
    // 1. Pause
    const pauseControl = makeControl('pause');
    const pauseBody = await signedPayload(pauseControl);
    const pauseRes = await POST(makeRequest(authId, pauseBody), {
      params: Promise.resolve({ id: authId }),
    });
    expect(pauseRes.status).toBe(200);
    const pauseJson = await pauseRes.json();
    expect(pauseJson).toMatchObject({
      id: authId,
      status: 'paused',
    });
    expect(pauseJson.state.phase).toBe('paused');

    // Verify stored status is paused
    const store = getStandingAuthorizationStore();
    const stored1 = await store.get(authId);
    expect(stored1?.status).toBe('paused');

    // 2. Resume
    const resumeControl = makeControl('resume');
    const resumeBody = await signedPayload(resumeControl);
    const resumeRes = await POST(makeRequest(authId, resumeBody), {
      params: Promise.resolve({ id: authId }),
    });
    expect(resumeRes.status).toBe(200);
    const resumeJson = await resumeRes.json();
    expect(resumeJson).toMatchObject({
      id: authId,
      status: 'active',
    });

    // 3. Cancel
    const cancelControl = makeControl('cancel');
    const cancelBody = await signedPayload(cancelControl);
    const cancelRes = await POST(makeRequest(authId, cancelBody), {
      params: Promise.resolve({ id: authId }),
    });
    expect(cancelRes.status).toBe(200);
    const cancelJson = await cancelRes.json();
    expect(cancelJson).toMatchObject({
      id: authId,
      status: 'cancelled',
    });
    expect(cancelJson.state.phase).toBe('cancelled');

    const stored2 = await store.get(authId);
    expect(stored2?.status).toBe('cancelled');
  });

  it('cancel then resume gives 409', async () => {
    // Cancel first
    const cancelControl = makeControl('cancel');
    const cancelBody = await signedPayload(cancelControl);
    const cancelRes = await POST(makeRequest(authId, cancelBody), {
      params: Promise.resolve({ id: authId }),
    });
    expect(cancelRes.status).toBe(200);

    // Try to resume
    const resumeControl = makeControl('resume');
    const resumeBody = await signedPayload(resumeControl);
    const resumeRes = await POST(makeRequest(authId, resumeBody), {
      params: Promise.resolve({ id: authId }),
    });
    expect(resumeRes.status).toBe(409);
    const resumeJson = await resumeRes.json();
    expect(resumeJson.code).toBe('INVALID_TRANSITION');
  });

  it('a signature from another key gives 401', async () => {
    const control = makeControl('pause');
    // Sign with otherKp, but present senderKp as publicKey
    const hash = await hashIntent(control);
    const signature = Buffer.from(otherKp.sign(Buffer.from(hash, 'hex'))).toString('base64');
    const body = {
      control,
      signature,
      publicKey: senderKp.publicKey(),
    };

    const res = await POST(makeRequest(authId, body), {
      params: Promise.resolve({ id: authId }),
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.code).toBe('UNAUTHORIZED');
  });

  it('authorizationId mismatch gives 403', async () => {
    const wrongId = randomUUID();
    const control = makeControl('pause', { authorizationId: wrongId });
    const body = await signedPayload(control);

    const res = await POST(makeRequest(authId, body), {
      params: Promise.resolve({ id: authId }),
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('FORBIDDEN');
  });

  it('the same nonce twice gives 409 REPLAY_DETECTED', async () => {
    const fixedNonce = '0123456789abcdef0123456789abcdef';
    const control1 = makeControl('pause', { nonce: fixedNonce });
    const body1 = await signedPayload(control1);

    const res1 = await POST(makeRequest(authId, body1), {
      params: Promise.resolve({ id: authId }),
    });
    expect(res1.status).toBe(200);

    const control2 = makeControl('resume', { nonce: fixedNonce });
    const body2 = await signedPayload(control2);

    const res2 = await POST(makeRequest(authId, body2), {
      params: Promise.resolve({ id: authId }),
    });
    expect(res2.status).toBe(409);
    const json2 = await res2.json();
    expect(json2.code).toBe('REPLAY_DETECTED');
  });

  it('a past deadline gives 410', async () => {
    const pastDeadline = new Date(Date.now() - 60_000).toISOString();
    const control = makeControl('pause', { deadline: pastDeadline });
    const body = await signedPayload(control);

    const res = await POST(makeRequest(authId, body), {
      params: Promise.resolve({ id: authId }),
    });
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.code).toBe('DEADLINE_EXPIRED');
  });

  it('flag off gives 404', async () => {
    flags.recurringIntents = false;
    const control = makeControl('pause');
    const body = await signedPayload(control);

    const res = await POST(makeRequest(authId, body), {
      params: Promise.resolve({ id: authId }),
    });
    expect(res.status).toBe(404);
  });

  it('after stopAt (inject time with vi.setSystemTime) gives 409', async () => {
    vi.useFakeTimers();
    // baseTerms.stopAt is '2026-12-31T23:59:59.000Z'
    // set system time to 2027-01-01
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));

    const control = makeControl('pause', {
      deadline: new Date('2027-01-01T01:00:00.000Z').toISOString(),
    });
    const body = await signedPayload(control);

    const res = await POST(makeRequest(authId, body), {
      params: Promise.resolve({ id: authId }),
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe('INVALID_TRANSITION');
  });
});
