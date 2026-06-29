import { describe, it, expect } from 'vitest';
import { sep6Reducer, isTerminal } from '@/lib/stellar/sep6-machine';
import type { Sep6MachineState, Sep6MachineEvent } from '@/lib/stellar/sep6-machine';

const IDLE: Sep6MachineState = { type: 'idle' };
const TXN = 'txn-sep6-abc';

// ─── Valid transitions ────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Array<{
  label: string;
  from: Sep6MachineState;
  event: Sep6MachineEvent;
  expected: Sep6MachineState;
}> = [
  {
    label: 'idle + NEEDS_INFO → collecting_info',
    from: IDLE,
    event: { type: 'NEEDS_INFO', fields: { dest: 'NG account' } },
    expected: { type: 'collecting_info', fields: { dest: 'NG account' } },
  },
  {
    label: 'idle + FUNDS_REQUIRED → awaiting_funds',
    from: IDLE,
    event: { type: 'FUNDS_REQUIRED', transactionId: TXN },
    expected: { type: 'awaiting_funds', transactionId: TXN },
  },
  {
    label: 'collecting_info + INFO_PROVIDED → idle (re-initiate)',
    from: { type: 'collecting_info', fields: {} },
    event: { type: 'INFO_PROVIDED' },
    expected: IDLE,
  },
  {
    label: 'collecting_info + CANCEL → failed with reason cancelled',
    from: { type: 'collecting_info', fields: {} },
    event: { type: 'CANCEL' },
    expected: { type: 'failed', reason: 'cancelled' },
  },
  {
    label: 'awaiting_funds + FUNDS_SENT → processing(pending_stellar)',
    from: { type: 'awaiting_funds', transactionId: TXN },
    event: { type: 'FUNDS_SENT', transactionId: TXN },
    expected: { type: 'processing', transactionId: TXN, anchorStatus: 'pending_stellar' },
  },
  {
    label: 'awaiting_funds + CANCEL → failed',
    from: { type: 'awaiting_funds', transactionId: TXN },
    event: { type: 'CANCEL' },
    expected: { type: 'failed', transactionId: TXN, reason: 'cancelled' },
  },
  {
    label: 'awaiting_funds + POLL_UPDATE(pending_external) → processing',
    from: { type: 'awaiting_funds', transactionId: TXN },
    event: { type: 'POLL_UPDATE', transactionId: TXN, anchorStatus: 'pending_external' },
    expected: { type: 'processing', transactionId: TXN, anchorStatus: 'pending_external' },
  },
  {
    label: 'processing + POLL_UPDATE(pending_anchor) → processing',
    from: { type: 'processing', transactionId: TXN, anchorStatus: 'pending_stellar' },
    event: { type: 'POLL_UPDATE', transactionId: TXN, anchorStatus: 'pending_anchor' },
    expected: { type: 'processing', transactionId: TXN, anchorStatus: 'pending_anchor' },
  },
  {
    label: 'processing + POLL_UPDATE(completed) → completed',
    from: { type: 'processing', transactionId: TXN, anchorStatus: 'pending_anchor' },
    event: { type: 'POLL_UPDATE', transactionId: TXN, anchorStatus: 'completed' },
    expected: { type: 'completed', transactionId: TXN },
  },
  {
    label: 'processing + POLL_UPDATE(refunded) → refunded',
    from: { type: 'processing', transactionId: TXN, anchorStatus: 'pending_anchor' },
    event: { type: 'POLL_UPDATE', transactionId: TXN, anchorStatus: 'refunded' },
    expected: { type: 'refunded', transactionId: TXN },
  },
  {
    label: 'processing + POLL_UPDATE(error) → failed',
    from: { type: 'processing', transactionId: TXN, anchorStatus: 'pending_anchor' },
    event: { type: 'POLL_UPDATE', transactionId: TXN, anchorStatus: 'error' },
    expected: { type: 'failed', transactionId: TXN, reason: 'error' },
  },
  {
    label: 'processing + POLL_UPDATE(expired) → failed',
    from: { type: 'processing', transactionId: TXN, anchorStatus: 'pending_anchor' },
    event: { type: 'POLL_UPDATE', transactionId: TXN, anchorStatus: 'expired' },
    expected: { type: 'failed', transactionId: TXN, reason: 'expired' },
  },
  {
    label: 'processing + POLL_UPDATE(no_market) → failed',
    from: { type: 'processing', transactionId: TXN, anchorStatus: 'pending_external' },
    event: { type: 'POLL_UPDATE', transactionId: TXN, anchorStatus: 'no_market' },
    expected: { type: 'failed', transactionId: TXN, reason: 'no_market' },
  },
  {
    label: 'processing + POLL_UPDATE(too_small) → failed',
    from: { type: 'processing', transactionId: TXN, anchorStatus: 'pending_stellar' },
    event: { type: 'POLL_UPDATE', transactionId: TXN, anchorStatus: 'too_small' },
    expected: { type: 'failed', transactionId: TXN, reason: 'too_small' },
  },
  {
    label: 'processing + POLL_UPDATE(too_large) → failed',
    from: { type: 'processing', transactionId: TXN, anchorStatus: 'pending_stellar' },
    event: { type: 'POLL_UPDATE', transactionId: TXN, anchorStatus: 'too_large' },
    expected: { type: 'failed', transactionId: TXN, reason: 'too_large' },
  },
  {
    label: 'processing + CANCEL → failed',
    from: { type: 'processing', transactionId: TXN, anchorStatus: 'pending_anchor' },
    event: { type: 'CANCEL' },
    expected: { type: 'failed', transactionId: TXN, reason: 'cancelled' },
  },
  {
    label: 'any state + RESET → idle',
    from: { type: 'processing', transactionId: TXN, anchorStatus: 'pending_anchor' },
    event: { type: 'RESET' },
    expected: IDLE,
  },
  {
    label: 'RESET from completed → idle',
    from: { type: 'completed', transactionId: TXN },
    event: { type: 'RESET' },
    expected: IDLE,
  },
];

describe('sep6Reducer — valid transitions', () => {
  it.each(VALID_TRANSITIONS)('$label', ({ from, event, expected }) => {
    expect(sep6Reducer(from, event)).toEqual(expected);
  });
});

// ─── Illegal no-op transitions ────────────────────────────────────────────────

const NOOP_TRANSITIONS: Array<{
  label: string;
  from: Sep6MachineState;
  event: Sep6MachineEvent;
}> = [
  {
    label: 'idle + INFO_PROVIDED stays idle',
    from: IDLE,
    event: { type: 'INFO_PROVIDED' },
  },
  {
    label: 'idle + FUNDS_SENT stays idle',
    from: IDLE,
    event: { type: 'FUNDS_SENT', transactionId: TXN },
  },
  {
    label: 'idle + POLL_UPDATE stays idle',
    from: IDLE,
    event: { type: 'POLL_UPDATE', transactionId: TXN, anchorStatus: 'pending_anchor' },
  },
  {
    label: 'collecting_info + NEEDS_INFO stays collecting_info',
    from: { type: 'collecting_info', fields: {} },
    event: { type: 'NEEDS_INFO', fields: { extra: 'x' } },
  },
  {
    label: 'collecting_info + FUNDS_SENT stays collecting_info',
    from: { type: 'collecting_info', fields: {} },
    event: { type: 'FUNDS_SENT', transactionId: TXN },
  },
  {
    label: 'awaiting_funds + INFO_PROVIDED stays awaiting_funds',
    from: { type: 'awaiting_funds', transactionId: TXN },
    event: { type: 'INFO_PROVIDED' },
  },
  {
    label: 'completed + POLL_UPDATE stays completed',
    from: { type: 'completed', transactionId: TXN },
    event: { type: 'POLL_UPDATE', transactionId: TXN, anchorStatus: 'pending_anchor' },
  },
  {
    label: 'failed + CANCEL stays failed',
    from: { type: 'failed', transactionId: TXN, reason: 'error' },
    event: { type: 'CANCEL' },
  },
  {
    label: 'refunded + FUNDS_SENT stays refunded',
    from: { type: 'refunded', transactionId: TXN },
    event: { type: 'FUNDS_SENT', transactionId: TXN },
  },
];

describe('sep6Reducer — illegal no-op transitions', () => {
  it.each(NOOP_TRANSITIONS)('$label', ({ from, event }) => {
    expect(sep6Reducer(from, event)).toEqual(from);
  });
});

// ─── isTerminal ───────────────────────────────────────────────────────────────

describe('isTerminal', () => {
  it('returns true for completed', () => {
    expect(isTerminal({ type: 'completed', transactionId: TXN })).toBe(true);
  });

  it('returns true for failed', () => {
    expect(isTerminal({ type: 'failed', reason: 'error' })).toBe(true);
  });

  it('returns true for refunded', () => {
    expect(isTerminal({ type: 'refunded', transactionId: TXN })).toBe(true);
  });

  it('returns false for idle', () => {
    expect(isTerminal(IDLE)).toBe(false);
  });

  it('returns false for processing', () => {
    expect(
      isTerminal({ type: 'processing', transactionId: TXN, anchorStatus: 'pending_anchor' })
    ).toBe(false);
  });

  it('returns false for awaiting_funds', () => {
    expect(isTerminal({ type: 'awaiting_funds', transactionId: TXN })).toBe(false);
  });

  it('returns false for collecting_info', () => {
    expect(isTerminal({ type: 'collecting_info', fields: {} })).toBe(false);
  });
});

// ─── Reducer purity ───────────────────────────────────────────────────────────

describe('sep6Reducer — purity', () => {
  it('does not mutate the input state', () => {
    const state: Sep6MachineState = { type: 'awaiting_funds', transactionId: TXN };
    const frozen = Object.freeze({ ...state });
    const next = sep6Reducer(frozen as Sep6MachineState, {
      type: 'FUNDS_SENT',
      transactionId: TXN,
    });
    expect(next).not.toBe(frozen);
    expect(frozen.type).toBe('awaiting_funds');
  });

  it('returns the same reference for no-op transitions', () => {
    const state: Sep6MachineState = IDLE;
    const next = sep6Reducer(state, { type: 'FUNDS_SENT', transactionId: TXN });
    expect(next).toBe(state);
  });
});
