import { describe, it, expect } from 'vitest';
import {
  periodWindow,
  remainingCapForPeriod,
  checkExecutionAgainstAuthorization,
} from '@/lib/recurring/enforce';
import type { StandingAuthorizationTerms, ExecutionRecord } from '@/types/recurring';

describe('enforce recurring policies', () => {
  const terms: StandingAuthorizationTerms = {
    type: 'recurring-authorization',
    version: 1,
    sender: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    corridorId: 'usdc-ngn',
    sourceAsset: 'USDC',
    destinationAsset: 'NGN',
    amount: '100',
    perPeriodCap: '300',
    period: 'daily',
    startDate: '2026-06-01T00:00:00.000Z',
    stopDate: '2026-06-30T23:59:59.000Z',
    anchorAllowlist: ['cowrie', 'mykobo'],
    nonce: 'nonce-123',
  };

  it('computes daily periodWindow aligned with startDate', () => {
    const ts = new Date('2026-06-03T12:00:00.000Z').getTime();
    const window = periodWindow('daily', ts, terms.startDate);
    expect(new Date(window.startMs).toISOString()).toBe('2026-06-03T00:00:00.000Z');
    expect(new Date(window.endMs).toISOString()).toBe('2026-06-04T00:00:00.000Z');
  });

  it('computes remainingCapForPeriod accurately', () => {
    const executions: ExecutionRecord[] = [
      {
        id: '1',
        intentHash: 'hash1',
        authorizationId: 'auth1',
        sender: terms.sender,
        anchorId: 'cowrie',
        amount: '100',
        executedAt: '2026-06-03T02:00:00.000Z',
        status: 'confirmed',
      },
      {
        id: '2',
        intentHash: 'hash2',
        authorizationId: 'auth1',
        sender: terms.sender,
        anchorId: 'cowrie',
        amount: '50',
        executedAt: '2026-06-03T05:00:00.000Z',
        status: 'confirmed',
      },
      {
        id: '3',
        intentHash: 'hash3',
        authorizationId: 'auth1',
        sender: terms.sender,
        anchorId: 'cowrie',
        amount: '100',
        executedAt: '2026-06-02T10:00:00.000Z', // previous day
        status: 'confirmed',
      },
    ];

    const targetTs = new Date('2026-06-03T10:00:00.000Z').getTime();
    const res = remainingCapForPeriod(terms, executions, targetTs);
    expect(res.totalSpent).toBe('150');
    expect(res.remainingCap).toBe('150');
  });

  it('rejects execution before startDate', () => {
    const check = checkExecutionAgainstAuthorization({
      terms,
      corridorId: 'usdc-ngn',
      anchorId: 'cowrie',
      amount: '50',
      executions: [],
      timestampMs: new Date('2026-05-31T23:59:59.000Z').getTime(),
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.code).toBe('BEFORE_START_DATE');
    }
  });

  it('rejects execution after stopDate', () => {
    const check = checkExecutionAgainstAuthorization({
      terms,
      corridorId: 'usdc-ngn',
      anchorId: 'cowrie',
      amount: '50',
      executions: [],
      timestampMs: new Date('2026-07-01T00:00:01.000Z').getTime(),
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.code).toBe('STOP_DATE_EXCEEDED');
    }
  });

  it('rejects non-allowlisted anchor', () => {
    const check = checkExecutionAgainstAuthorization({
      terms,
      corridorId: 'usdc-ngn',
      anchorId: 'unlisted-anchor',
      amount: '50',
      executions: [],
      timestampMs: new Date('2026-06-05T10:00:00.000Z').getTime(),
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.code).toBe('ANCHOR_NOT_ALLOWED');
    }
  });

  it('rejects amount exceeding per-execution limit', () => {
    const check = checkExecutionAgainstAuthorization({
      terms,
      corridorId: 'usdc-ngn',
      anchorId: 'cowrie',
      amount: '150',
      executions: [],
      timestampMs: new Date('2026-06-05T10:00:00.000Z').getTime(),
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.code).toBe('AMOUNT_MISMATCH');
    }
  });

  it('rejects amount exceeding remaining period cap', () => {
    const executions: ExecutionRecord[] = [
      {
        id: '1',
        intentHash: 'hash1',
        authorizationId: 'auth1',
        sender: terms.sender,
        anchorId: 'cowrie',
        amount: '100',
        executedAt: '2026-06-05T01:00:00.000Z',
        status: 'confirmed',
      },
      {
        id: '2',
        intentHash: 'hash2',
        authorizationId: 'auth1',
        sender: terms.sender,
        anchorId: 'cowrie',
        amount: '100',
        executedAt: '2026-06-05T02:00:00.000Z',
        status: 'confirmed',
      },
      {
        id: '3',
        intentHash: 'hash3',
        authorizationId: 'auth1',
        sender: terms.sender,
        anchorId: 'cowrie',
        amount: '100',
        executedAt: '2026-06-05T03:00:00.000Z',
        status: 'confirmed',
      },
    ];

    const check = checkExecutionAgainstAuthorization({
      terms,
      corridorId: 'usdc-ngn',
      anchorId: 'cowrie',
      amount: '50',
      executions,
      timestampMs: new Date('2026-06-05T10:00:00.000Z').getTime(),
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.code).toBe('CAP_EXCEEDED');
    }
  });

  it('allows valid execution and returns remaining cap', () => {
    const check = checkExecutionAgainstAuthorization({
      terms,
      corridorId: 'usdc-ngn',
      anchorId: 'cowrie',
      amount: '100',
      executions: [],
      timestampMs: new Date('2026-06-05T10:00:00.000Z').getTime(),
    });
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.remainingAfter).toBe('200');
    }
  });
});
