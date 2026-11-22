import { describe, it, expect } from 'vitest';
import {
  computeAuthorizationState,
  type StandingAuthorizationRecord,
  type StandingExecutionRecord,
} from '@/lib/recurring';

const SENDER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

function createRecord(overrides: Partial<StandingAuthorizationRecord> = {}): StandingAuthorizationRecord {
  return {
    id: 'auth-123',
    termsHash: 'a'.repeat(64),
    status: 'active',
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
    authorization: {
      terms: {
        type: 'recurring-authorization',
        version: 1,
        sender: SENDER,
        corridorId: 'usdc-ngn',
        sourceAsset: 'USDC',
        destinationAsset: 'NGN',
        amount: '100',
        perPeriodCap: '250',
        period: 'daily',
        startAt: '2026-11-20T00:00:00.000Z',
        stopAt: '2026-11-25T00:00:00.000Z',
        anchorAllowlist: ['moneygram'],
        nonce: '0123456789abcdef0123456789abcdef',
      },
      termsHash: 'a'.repeat(64),
      signature: 'test-sig',
      publicKey: SENDER,
    },
    ...overrides,
  };
}

describe('recurring-due (REC006)', () => {
  it('covers every phase', () => {
    const record = createRecord();

    // 1. scheduled (before startAt)
    const stScheduled = computeAuthorizationState(record, [], new Date('2026-11-19T23:59:59Z'));
    expect(stScheduled.phase).toBe('scheduled');
    expect(stScheduled.due).toBeNull();
    expect(stScheduled.nextDueAt).toBe('2026-11-20T00:00:00.000Z');
    expect(stScheduled.missedPeriods).toBe(0);

    // 2. due (period 0, no executions)
    const stDue = computeAuthorizationState(record, [], new Date('2026-11-20T05:00:00Z'));
    expect(stDue.phase).toBe('due');
    expect(stDue.due?.amount).toBe('100');
    expect(stDue.due?.cycleNumber).toBe(1);
    expect(stDue.due?.periodIndex).toBe(0);
    expect(stDue.nextDueAt).toBe('2026-11-20T00:00:00.000Z');

    // 3. confirmed_this_period
    const executions: StandingExecutionRecord[] = [
      {
        id: 'exec-1',
        authorizationId: 'auth-123',
        cycleNumber: 1,
        periodIndex: 0,
        amount: '100',
        anchorId: 'moneygram',
        intentHash: 'b'.repeat(64),
        transactionId: 'tx-1',
        status: 'confirmed',
        rejectCode: null,
        createdAt: '2026-11-20T06:00:00.000Z',
      },
    ];
    const stConfirmed = computeAuthorizationState(record, executions, new Date('2026-11-20T12:00:00Z'));
    expect(stConfirmed.phase).toBe('confirmed_this_period');
    expect(stConfirmed.due).toBeNull();
    expect(stConfirmed.nextDueAt).toBe('2026-11-21T00:00:00.000Z');

    // 4. cap_reached (executed up to cap 250 in this period without an exact periodIndex match or across executions)
    const capExecutions: StandingExecutionRecord[] = [
      {
        id: 'exec-2',
        authorizationId: 'auth-123',
        cycleNumber: 99,
        periodIndex: 99, // period index not 0
        amount: '250',
        anchorId: 'moneygram',
        intentHash: 'c'.repeat(64),
        transactionId: 'tx-2',
        status: 'confirmed',
        rejectCode: null,
        createdAt: '2026-11-20T07:00:00.000Z', // in period 0 window
      },
    ];
    const stCap = computeAuthorizationState(record, capExecutions, new Date('2026-11-20T12:00:00Z'));
    expect(stCap.phase).toBe('cap_reached');
    expect(stCap.due).toBeNull();

    // 5. paused
    const stPaused = computeAuthorizationState(createRecord({ status: 'paused' }), [], new Date('2026-11-20T12:00:00Z'));
    expect(stPaused.phase).toBe('paused');
    expect(stPaused.due).toBeNull();
    expect(stPaused.nextDueAt).toBeNull();

    // 6. cancelled
    const stCancelled = computeAuthorizationState(createRecord({ status: 'cancelled' }), [], new Date('2026-11-20T12:00:00Z'));
    expect(stCancelled.phase).toBe('cancelled');
    expect(stCancelled.due).toBeNull();
    expect(stCancelled.nextDueAt).toBeNull();

    // 7. completed (now >= stopAt)
    const stCompleted = computeAuthorizationState(record, [], new Date('2026-11-25T00:00:00Z'));
    expect(stCompleted.phase).toBe('completed');
    expect(stCompleted.due).toBeNull();
    expect(stCompleted.nextDueAt).toBeNull();
  });

  it('clamps due amount to remaining cap when cap is less than terms.amount', () => {
    const record = createRecord();
    // Prior execution used 200 of 250 cap -> remaining is 50 (< terms.amount of 100)
    const executions: StandingExecutionRecord[] = [
      {
        id: 'exec-partial',
        authorizationId: 'auth-123',
        cycleNumber: 99,
        periodIndex: 99,
        amount: '200',
        anchorId: 'moneygram',
        intentHash: 'd'.repeat(64),
        transactionId: 'tx-partial',
        status: 'confirmed',
        rejectCode: null,
        createdAt: '2026-11-20T04:00:00.000Z',
      },
    ];

    const state = computeAuthorizationState(record, executions, new Date('2026-11-20T12:00:00Z'));
    expect(state.phase).toBe('due');
    expect(state.due?.amount).toBe('50');
    expect(state.due?.remainingCap).toBe('50');
  });

  it('counts missed periods correctly across gaps and ignores rejected executions', () => {
    const record = createRecord(); // 5 daily periods: Nov 20, 21, 22, 23, 24
    // Suppose period 0 was confirmed, period 1 had a rejected execution, period 2 was confirmed.
    // Now is in period 3 (Nov 23):
    const executions: StandingExecutionRecord[] = [
      {
        id: 'exec-p0',
        authorizationId: 'auth-123',
        cycleNumber: 1,
        periodIndex: 0,
        amount: '100',
        anchorId: 'moneygram',
        intentHash: 'e'.repeat(64),
        transactionId: 'tx-p0',
        status: 'confirmed',
        rejectCode: null,
        createdAt: '2026-11-20T05:00:00.000Z',
      },
      {
        id: 'exec-p1-rejected',
        authorizationId: 'auth-123',
        cycleNumber: 2,
        periodIndex: 1,
        amount: '100',
        anchorId: 'moneygram',
        intentHash: 'f'.repeat(64),
        transactionId: null,
        status: 'rejected',
        rejectCode: 'balance_insufficient',
        createdAt: '2026-11-21T05:00:00.000Z',
      },
      {
        id: 'exec-p2',
        authorizationId: 'auth-123',
        cycleNumber: 3,
        periodIndex: 2,
        amount: '100',
        anchorId: 'moneygram',
        intentHash: '1'.repeat(64),
        transactionId: 'tx-p2',
        status: 'confirmed',
        rejectCode: null,
        createdAt: '2026-11-22T05:00:00.000Z',
      },
    ];

    // On Nov 23 (period 3): indices 0..2 had: 0 confirmed, 1 rejected (not confirmed -> missed!), 2 confirmed.
    // Missed = 1
    const state = computeAuthorizationState(record, executions, new Date('2026-11-23T10:00:00Z'));
    expect(state.phase).toBe('due');
    expect(state.due?.cycleNumber).toBe(4);
    expect(state.missedPeriods).toBe(1);

    // After stop date (completed): periods 0..4 total 5 periods.
    // Confirmed periods: 0 and 2. Missed periods: 1, 3, 4 -> total 3 missed!
    const stateCompleted = computeAuthorizationState(record, executions, new Date('2026-11-25T12:00:00Z'));
    expect(stateCompleted.phase).toBe('completed');
    expect(stateCompleted.missedPeriods).toBe(3);
  });

  it('handles monthly windows across a year boundary', () => {
    const monthlyRecord = createRecord();
    monthlyRecord.authorization.terms.period = 'monthly';
    monthlyRecord.authorization.terms.startAt = '2026-11-15T00:00:00.000Z';
    monthlyRecord.authorization.terms.stopAt = '2027-02-15T00:00:00.000Z';

    // In Jan 2027: index should be 2 (Nov=0, Dec=1, Jan=2)
    const stateJan = computeAuthorizationState(monthlyRecord, [], new Date('2027-01-10T12:00:00Z'));
    expect(stateJan.phase).toBe('due');
    expect(stateJan.due?.periodIndex).toBe(2);
    expect(stateJan.due?.cycleNumber).toBe(3);
    expect(stateJan.due?.periodStart).toBe('2027-01-01T00:00:00.000Z');
    expect(stateJan.due?.periodEnd).toBe('2027-02-01T00:00:00.000Z');
  });
});
