import { describe, expect, it } from 'vitest';
import {
  DEPOSIT_NON_TERMINAL_EXPLAINERS,
  DEPOSIT_STATUS_LABELS,
  statusExplainer,
} from '@/lib/stellar/status-messages';
import { STATUS_MAP } from '@/lib/stellar/sep24-status-map';
import type { WithdrawStatusValue } from '@/types';

// For a deposit, pending_user_transfer_start means the user must send fiat to the
// anchor. The withdraw copy says the opposite (#1466).

const NON_TERMINAL: WithdrawStatusValue[] = [
  'incomplete',
  'pending_user_transfer_start',
  'pending_user_transfer_complete',
  'pending_external',
  'pending_anchor',
  'pending_stellar',
  'pending_trust',
  'pending_user',
];

describe('statusExplainer direction (#1466)', () => {
  it('tells a depositor to send their payment', () => {
    const text = statusExplainer('pending_user_transfer_start', 'deposit');
    expect(text).toBe('Send your payment to the anchor using the instructions below.');
    expect(text).toMatch(/send your payment/i);
  });

  it('keeps the withdraw text as the default, and when asked for explicitly', () => {
    const withdraw = 'Waiting for the USDC payment to reach the anchor.';
    expect(statusExplainer('pending_user_transfer_start')).toBe(withdraw);
    expect(statusExplainer('pending_user_transfer_start', 'withdraw')).toBe(withdraw);
  });

  it('never gives a depositor the withdraw wording', () => {
    for (const status of NON_TERMINAL) {
      expect(statusExplainer(status, 'deposit')).not.toBe(statusExplainer(status, 'withdraw'));
    }
  });

  it('has a deposit explainer for every non-terminal status', () => {
    for (const status of NON_TERMINAL) {
      expect(DEPOSIT_NON_TERMINAL_EXPLAINERS[status], status).toBeTruthy();
    }
  });

  it('returns null for terminal statuses in both directions', () => {
    for (const status of ['completed', 'refunded', 'error', 'expired'] as const) {
      expect(statusExplainer(status, 'deposit')).toBeNull();
      expect(statusExplainer(status, 'withdraw')).toBeNull();
    }
  });
});

describe('DEPOSIT_STATUS_LABELS (#1466)', () => {
  it('has a label for every key of STATUS_MAP, and no others', () => {
    expect(Object.keys(DEPOSIT_STATUS_LABELS).sort()).toEqual(Object.keys(STATUS_MAP).sort());
    for (const label of Object.values(DEPOSIT_STATUS_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('labels pending_user_transfer_start as the payment step', () => {
    expect(DEPOSIT_STATUS_LABELS.pending_user_transfer_start).toBe('Send payment to anchor');
  });
});
