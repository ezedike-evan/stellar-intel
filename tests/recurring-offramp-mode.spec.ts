import { describe, it, expect } from 'vitest';
import {
  parseRecurringParams,
  filterRatesToAllowlist,
  exceedsRemainingCap,
  withRecurringFields,
} from '@/lib/recurring/offramp-mode';
import type { AnchorRate } from '@/types';

describe('Recurring Offramp Mode (REC011)', () => {
  it('parses valid recurring search params', () => {
    const sp = new URLSearchParams(
      'recurring=1&authId=abc123hex&corridorId=usdc-ngn&amount=50&allowlist=cowrie,mykobo&remainingCap=100'
    );
    const parsed = parseRecurringParams(sp);
    expect(parsed).not.toBeNull();
    expect(parsed?.recurring).toBe(true);
    expect(parsed?.authId).toBe('abc123hex');
    expect(parsed?.allowlist).toEqual(['cowrie', 'mykobo']);
    expect(parsed?.remainingCap).toBe('100');
  });

  it('filters rates strictly to allowlist', () => {
    const rates: AnchorRate[] = [
      { anchorId: 'cowrie', anchorName: 'Cowrie', corridorId: 'usdc-ngn', exchangeRate: 1500, fee: 1 } as unknown as AnchorRate,
      { anchorId: 'other', anchorName: 'Other', corridorId: 'usdc-ngn', exchangeRate: 1510, fee: 1 } as unknown as AnchorRate,
    ];

    const filtered = filterRatesToAllowlist(rates, ['cowrie']);
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.anchorId).toBe('cowrie');
  });

  it('detects when amount exceeds remaining cap', () => {
    expect(exceedsRemainingCap('150', '100')).toBe(true);
    expect(exceedsRemainingCap('50', '100')).toBe(false);
    expect(exceedsRemainingCap('100', '100')).toBe(false);
  });

  it('augments intent payload with recurring fields', () => {
    const intent = { type: 'offramp-outcome', amount: '50' };
    const augmented = withRecurringFields(intent, {
      recurring: true,
      authId: 'auth-123',
    });
    expect(augmented.recurring).toBe(true);
    expect(augmented.authorizationId).toBe('auth-123');
  });
});
