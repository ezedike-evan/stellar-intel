import { describe, it, expect } from 'vitest';
import { computeAuthorizationState } from '@/lib/recurring/due';
import type { StoredStandingAuthorization } from '@/types/recurring';

describe('computeAuthorizationState', () => {
  const baseAuth: StoredStandingAuthorization = {
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
      startDate: '2026-06-01T00:00:00.000Z',
      stopDate: '2026-06-30T00:00:00.000Z',
      anchorAllowlist: ['cowrie'],
      nonce: 'nonce-1',
    },
    termsHash: '1111111111111111111111111111111111111111111111111111111111111111',
    signature: 'sig==',
    publicKey: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    createdAt: '2026-05-30T00:00:00.000Z',
    status: 'active',
    executions: [],
  };

  it('marks scheduled when before startDate', () => {
    const res = computeAuthorizationState(
      baseAuth,
      new Date('2026-05-31T12:00:00.000Z').getTime()
    );
    expect(res.phase).toBe('scheduled');
    expect(res.due).toBe(false);
  });

  it('marks due when in active period without execution', () => {
    const res = computeAuthorizationState(
      baseAuth,
      new Date('2026-06-01T12:00:00.000Z').getTime()
    );
    expect(res.phase).toBe('due');
    expect(res.due).toBe(true);
  });

  it('marks confirmed_this_period when already executed in period', () => {
    const executedAuth: StoredStandingAuthorization = {
      ...baseAuth,
      executions: [
        {
          id: 'e1',
          intentHash: 'h1',
          authorizationId: baseAuth.termsHash,
          sender: baseAuth.terms.sender,
          anchorId: 'cowrie',
          amount: '50',
          executedAt: '2026-06-01T02:00:00.000Z',
          status: 'confirmed',
        },
      ],
    };

    const res = computeAuthorizationState(
      executedAuth,
      new Date('2026-06-01T12:00:00.000Z').getTime()
    );
    expect(res.phase).toBe('confirmed_this_period');
    expect(res.due).toBe(false);
  });

  it('marks cap_reached when period cap exhausted', () => {
    const maxedAuth: StoredStandingAuthorization = {
      ...baseAuth,
      executions: [
        {
          id: 'e1',
          intentHash: 'h1',
          authorizationId: baseAuth.termsHash,
          sender: baseAuth.terms.sender,
          anchorId: 'cowrie',
          amount: '100',
          executedAt: '2026-06-01T02:00:00.000Z',
          status: 'confirmed',
        },
      ],
    };

    const res = computeAuthorizationState(
      maxedAuth,
      new Date('2026-06-01T12:00:00.000Z').getTime()
    );
    expect(res.phase).toBe('cap_reached');
    expect(res.due).toBe(false);
  });

  it('marks paused or cancelled when status matches', () => {
    const paused = computeAuthorizationState({ ...baseAuth, status: 'paused' });
    expect(paused.phase).toBe('paused');
    expect(paused.due).toBe(false);

    const cancelled = computeAuthorizationState({ ...baseAuth, status: 'cancelled' });
    expect(cancelled.phase).toBe('cancelled');
    expect(cancelled.due).toBe(false);
  });
});
