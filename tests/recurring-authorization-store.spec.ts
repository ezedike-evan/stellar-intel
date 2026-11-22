import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryStandingAuthorizationStore,
  getStore,
  resetStandingAuthorizationStore,
} from '@/lib/recurring/authorization-store';
import type { SignedStandingAuthorization, ExecutionRecord } from '@/types/recurring';

describe('StandingAuthorizationStore', () => {
  beforeEach(() => {
    resetStandingAuthorizationStore();
  });

  const dummySigned: SignedStandingAuthorization = {
    terms: {
      type: 'recurring-authorization',
      version: 1,
      sender: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      corridorId: 'usdc-ngn',
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      amount: '50',
      perPeriodCap: '100',
      period: 'daily',
      startDate: '2026-01-01T00:00:00.000Z',
      anchorAllowlist: ['cowrie'],
      nonce: 'nonce-1',
    },
    termsHash: '1111111111111111111111111111111111111111111111111111111111111111',
    signature: 'sig==',
    publicKey: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  };

  it('saves and retrieves authorization by id', async () => {
    const store = getStore();
    const saved = await store.save(dummySigned);
    expect(saved.termsHash).toBe(dummySigned.termsHash);
    expect(saved.status).toBe('active');

    const fetched = await store.get(dummySigned.termsHash);
    expect(fetched).not.toBeNull();
    expect(fetched?.termsHash).toBe(dummySigned.termsHash);
  });

  it('updates status and metadata', async () => {
    const store = getStore();
    await store.save(dummySigned);

    const updated = await store.updateStatus(dummySigned.termsHash, 'paused', {
      pausedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(updated?.status).toBe('paused');
    expect(updated?.pausedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('records executions without duplicate intentHash', async () => {
    const store = getStore();
    await store.save(dummySigned);

    const exec: ExecutionRecord = {
      id: 'e1',
      intentHash: 'hash-abc',
      authorizationId: dummySigned.termsHash,
      sender: dummySigned.terms.sender,
      anchorId: 'cowrie',
      amount: '50',
      executedAt: '2026-01-02T00:00:00.000Z',
      status: 'confirmed',
    };

    await store.recordExecution(dummySigned.termsHash, exec);
    await store.recordExecution(dummySigned.termsHash, exec); // duplicate

    const record = await store.get(dummySigned.termsHash);
    expect(record?.executions.length).toBe(1);
  });
});
