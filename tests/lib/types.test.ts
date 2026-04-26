import { describe, it, expect } from 'vitest';
import type { WithdrawStatus, AnchorRate } from '@/types';

describe('WithdrawStatus', () => {
  it('accepts a valid WithdrawStatus object', () => {
    const status: WithdrawStatus = {
      id: 'txn-123',
      status: 'pending_external',
      amountIn: '100',
      amountOut: '97.50',
      amountFee: '2.50',
      updatedAt: new Date(),
      stellarTransactionId: undefined,
    };
    expect(status.id).toBe('txn-123');
    expect(status.status).toBe('pending_external');
  });

  it('accepts a completed status with a stellar transaction id', () => {
    const status: WithdrawStatus = {
      id: 'txn-456',
      status: 'completed',
      updatedAt: new Date(),
      stellarTransactionId: 'abc123',
    };
    expect(status.stellarTransactionId).toBe('abc123');
  });
});

describe('AnchorRate', () => {
  it('accepts a valid AnchorRate without isMock', () => {
    const rate: AnchorRate = {
      anchorId: 'cowrie',
      anchorName: 'Cowrie Exchange',
      corridorId: 'usdc-ngn',
      fee: 2,
      feeType: 'flat',
      exchangeRate: 1580,
      totalReceived: 153660,
      updatedAt: new Date(),
    };
    expect(rate.anchorId).toBe('cowrie');
    // isMock must not exist on the type
    expect('isMock' in rate).toBe(false);
  });
});
