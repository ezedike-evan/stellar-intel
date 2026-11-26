import { beforeEach, describe, expect, it } from 'vitest';
import {
  InMemoryStandingAuthorizationStore,
  type StandingAuthorizationRecord,
  type StandingExecutionRecord,
} from '@/lib/recurring/authorization-store';
import type { SignedStandingAuthorization } from '@/types/recurring';

function makeAuth(
  overrides: Partial<SignedStandingAuthorization> = {}
): SignedStandingAuthorization {
  return {
    terms: {
      type: 'recurring-authorization',
      version: 1,
      sender: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      corridorId: 'usdc-ngn',
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      amount: '100',
      perPeriodCap: '500',
      period: 'monthly',
      startAt: '2026-01-01T00:00:00.000Z',
      stopAt: '2026-12-31T23:59:59.000Z',
      anchorAllowlist: ['cowrie'],
      nonce: '0123456789abcdef0123456789abcdef',
    },
    termsHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    signature: 'sig...',
    publicKey: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    ...overrides,
  };
}

function makeRecord(
  overrides: Partial<StandingAuthorizationRecord> = {}
): StandingAuthorizationRecord {
  const auth = makeAuth();
  return {
    id: 'auth-1',
    termsHash: auth.termsHash,
    authorization: auth,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeExecution(overrides: Partial<StandingExecutionRecord> = {}): StandingExecutionRecord {
  return {
    id: 'exec-1',
    authorizationId: 'auth-1',
    cycleNumber: 1,
    periodIndex: 0,
    amount: '100',
    anchorId: 'cowrie',
    intentHash: 'hash-1',
    transactionId: 'tx-1',
    status: 'confirmed',
    rejectCode: null,
    createdAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('InMemoryStandingAuthorizationStore (#2168)', () => {
  let store: InMemoryStandingAuthorizationStore;

  beforeEach(() => {
    store = new InMemoryStandingAuthorizationStore();
  });

  it('create and get round-trip', async () => {
    const record = makeRecord();
    const created = await store.create(record);
    expect(created).toEqual({ ok: true });

    const fetched = await store.get(record.id);
    expect(fetched).toEqual(record);
  });

  it('duplicate id, and duplicate termsHash with a new id, both give duplicate', async () => {
    const record = makeRecord();
    await store.create(record);

    // Duplicate ID
    const dupId = makeRecord({ termsHash: 'different-hash' });
    expect(await store.create(dupId)).toEqual({ ok: false, code: 'duplicate' });

    // Duplicate termsHash with new ID
    const dupHash = makeRecord({ id: 'auth-2', termsHash: record.termsHash });
    expect(await store.create(dupHash)).toEqual({ ok: false, code: 'duplicate' });
  });

  it('setStatus on an unknown id gives null', async () => {
    const res = await store.setStatus('unknown-id', 'paused', '2026-01-05T00:00:00.000Z');
    expect(res).toBeNull();
  });

  it('setStatus updates status and updatedAt', async () => {
    const record = makeRecord();
    await store.create(record);

    const updated = await store.setStatus(record.id, 'paused', '2026-01-05T12:00:00.000Z');
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe('paused');
    expect(updated?.updatedAt).toBe('2026-01-05T12:00:00.000Z');

    const fetched = await store.get(record.id);
    expect(fetched?.status).toBe('paused');
    expect(fetched?.updatedAt).toBe('2026-01-05T12:00:00.000Z');
  });

  it('a second confirmed execution for the same cycle gives duplicate_cycle', async () => {
    const exec1 = makeExecution({ id: 'e1', cycleNumber: 1, status: 'confirmed' });
    expect(await store.appendExecution(exec1)).toEqual({ ok: true });

    const exec2 = makeExecution({ id: 'e2', cycleNumber: 1, status: 'confirmed' });
    expect(await store.appendExecution(exec2)).toEqual({ ok: false, code: 'duplicate_cycle' });
  });

  it('a rejected plus a confirmed execution for the same cycle are both accepted', async () => {
    const rejected = makeExecution({
      id: 'e-rej',
      cycleNumber: 1,
      status: 'rejected',
      rejectCode: 'quote_expired',
    });
    expect(await store.appendExecution(rejected)).toEqual({ ok: true });

    const confirmed = makeExecution({
      id: 'e-conf',
      cycleNumber: 1,
      status: 'confirmed',
    });
    expect(await store.appendExecution(confirmed)).toEqual({ ok: true });

    const list = await store.listExecutions('auth-1');
    expect(list.length).toBe(2);
  });

  it('orders listExecutions by cycleNumber then createdAt ascending', async () => {
    await store.appendExecution(
      makeExecution({ id: 'e3', cycleNumber: 2, createdAt: '2026-02-01T00:00:00.000Z' })
    );
    await store.appendExecution(
      makeExecution({ id: 'e1', cycleNumber: 1, createdAt: '2026-01-01T12:00:00.000Z' })
    );
    await store.appendExecution(
      makeExecution({
        id: 'e2',
        cycleNumber: 1,
        status: 'rejected',
        createdAt: '2026-01-01T10:00:00.000Z',
      })
    );

    const list = await store.listExecutions('auth-1');
    expect(list.map((e) => e.id)).toEqual(['e2', 'e1', 'e3']);
  });

  it('mutating a returned record does not change the store', async () => {
    const record = makeRecord();
    await store.create(record);

    const fetched = await store.get(record.id);
    expect(fetched).not.toBeNull();
    if (fetched) {
      fetched.status = 'cancelled';
      fetched.authorization.terms.amount = '9999';
    }

    const reFetched = await store.get(record.id);
    expect(reFetched?.status).toBe('active');
    expect(reFetched?.authorization.terms.amount).toBe('100');
  });
});
