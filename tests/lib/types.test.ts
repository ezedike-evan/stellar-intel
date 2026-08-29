import { describe, it, expect } from 'vitest';
import { isIndicativeRateSource, type Sep24Transaction, type AnchorRate } from '@/types';

describe('Sep24Transaction', () => {
  it('accepts a valid Sep24Transaction object', () => {
    const status: Sep24Transaction = {
      id: 'txn-123',
      status: 'pending_external',
      amountIn: '100',
      amountOut: '97.50',
      amountFee: '2.50',
      updatedAt: new Date(),
    };
    expect(status.id).toBe('txn-123');
    expect(status.status).toBe('pending_external');
  });

  it('accepts a completed status with a stellar transaction id', () => {
    const status: Sep24Transaction = {
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
      source: 'sep24-fee' as const,
      updatedAt: new Date(),
    };
    expect(rate.anchorId).toBe('cowrie');
    // isMock must not exist on the type
    expect('isMock' in rate).toBe(false);
  });
});

describe('isIndicativeRateSource', () => {
  it('treats sep38 as firm, not indicative', () => {
    expect(isIndicativeRateSource('sep38')).toBe(false);
  });

  it('treats sep24-fee, sep6-info, and sep6-fee as indicative', () => {
    expect(isIndicativeRateSource('sep24-fee')).toBe(true);
    expect(isIndicativeRateSource('sep6-info')).toBe(true);
    expect(isIndicativeRateSource('sep6-fee')).toBe(true);
  });

  it('treats unavailable as not indicative (there is no rate to caveat)', () => {
    expect(isIndicativeRateSource('unavailable')).toBe(false);
  });
});
