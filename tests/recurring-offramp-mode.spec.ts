import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  exceedsRemainingCap,
  filterRatesToAllowlist,
  parseRecurringParams,
  withRecurringFields,
  type RecurringOfframpContext,
} from '@/lib/recurring/offramp-mode';
import { RecurringExecutionIntentSchema } from '@/lib/recurring/execution';
import type { Intent } from '@/lib/intent/hash';

// REC011 — the pure helpers behind standing-order mode on /offramp.

const AUTH_ID = '0b6f1f8e-3a52-4c1d-9a0e-5f2b7c4d8e11';

describe('parseRecurringParams', () => {
  it('accepts a UUID and a cycle of 1 or more', () => {
    expect(
      parseRecurringParams(`corridor=usdc-ngn&amount=100&recurring=${AUTH_ID}&cycle=3`)
    ).toEqual({ authorizationId: AUTH_ID, cycleNumber: 3 });
    expect(parseRecurringParams(`?recurring=${AUTH_ID}&cycle=1`)).toEqual({
      authorizationId: AUTH_ID,
      cycleNumber: 1,
    });
  });

  it('rejects a missing cycle', () => {
    expect(parseRecurringParams(`recurring=${AUTH_ID}`)).toBeNull();
  });

  it('rejects cycle=0', () => {
    expect(parseRecurringParams(`recurring=${AUTH_ID}&cycle=0`)).toBeNull();
  });

  it('rejects a cycle that is not an integer', () => {
    expect(parseRecurringParams(`recurring=${AUTH_ID}&cycle=1.5`)).toBeNull();
    expect(parseRecurringParams(`recurring=${AUTH_ID}&cycle=-1`)).toBeNull();
    expect(parseRecurringParams(`recurring=${AUTH_ID}&cycle=abc`)).toBeNull();
  });

  it('rejects a non-UUID id and a missing id', () => {
    expect(parseRecurringParams('recurring=abc123&cycle=1')).toBeNull();
    expect(parseRecurringParams('cycle=1')).toBeNull();
    expect(parseRecurringParams('')).toBeNull();
  });
});

describe('filterRatesToAllowlist', () => {
  const rates = [
    { anchorId: 'moneygram', totalReceived: 1 },
    { anchorId: 'latamex', totalReceived: 2 },
    { anchorId: 'aps', totalReceived: 3 },
  ];

  it('keeps only allowlisted anchors, in their original order', () => {
    expect(filterRatesToAllowlist(rates, ['aps', 'moneygram'])).toEqual([rates[0], rates[2]]);
  });

  it('returns nothing for an empty allowlist', () => {
    expect(filterRatesToAllowlist(rates, [])).toEqual([]);
  });
});

describe('withRecurringFields', () => {
  const ctx: RecurringOfframpContext = {
    authorizationId: AUTH_ID,
    cycleNumber: 2,
    anchorAllowlist: ['moneygram'],
    remainingCap: '80',
  };
  const base: Intent = {
    type: 'offramp-outcome',
    sourceAsset: 'USDC',
    destinationAsset: 'NGN',
    amount: '50',
    sender: Keypair.random().publicKey(),
    recipient: 'moneygram',
    anchorId: 'moneygram',
    corridor: 'usdc-ngn',
    transactionId: 'tx-123',
  };

  it('produces an intent that passes RecurringExecutionIntentSchema', () => {
    const intent = withRecurringFields(base, ctx);
    expect(intent.recurringAuthorizationId).toBe(AUTH_ID);
    expect(intent.cycleNumber).toBe(2);
    expect(RecurringExecutionIntentSchema.safeParse(intent).success).toBe(true);
  });

  it('keeps a signed minReceive floor valid under the strict schema', () => {
    const intent = withRecurringFields({ ...base, minReceive: '74000.50' }, ctx);
    expect(RecurringExecutionIntentSchema.safeParse(intent).success).toBe(true);
  });

  it('does not mutate the original intent', () => {
    withRecurringFields(base, ctx);
    expect(base).not.toHaveProperty('recurringAuthorizationId');
  });
});

describe('exceedsRemainingCap', () => {
  it('is false at exactly the remaining cap and true just above it', () => {
    expect(exceedsRemainingCap('80', '80')).toBe(false);
    expect(exceedsRemainingCap('80.0000000', '80')).toBe(false);
    expect(exceedsRemainingCap('80.0000001', '80')).toBe(true);
    expect(exceedsRemainingCap('79.9999999', '80')).toBe(false);
  });

  it('treats any positive amount as over a zero cap', () => {
    expect(exceedsRemainingCap('0.0000001', '0')).toBe(true);
  });
});
