import { describe, it, expect } from 'vitest';
import { solveMultiAnchor } from '@/lib/router/solve';
import type { Intent, EvaluatedQuote } from '@/types';

function createTestIntent(overrides?: Partial<Intent>): Intent {
  const futureISO = new Date(Date.now() + 3600 * 1000).toISOString();
  return {
    version: 1,
    nonce: '550e8400e29b41d4a716446655440000',
    account: 'GA5ZSEJYB37JRC5AVCIA5MOP4MY5KU4ERRJLSORRQ7ROVQA5SV6LQ34',
    corridor: 'usdc-ngn',
    sellAsset: { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4MY5KU4ERRJLSORRQ7ROVQA5SV6LQ34' },
    sellAmount: '100',
    buyAsset: { code: 'NGN' },
    minReceive: '1',
    deliveryHint: 'bank_account',
    deadline: futureISO,
    ...overrides,
  };
}

function createTestQuote(overrides: Partial<EvaluatedQuote> & { id: string }): EvaluatedQuote {
  const futureISO = new Date(Date.now() + 300 * 1000).toISOString();
  return {
    id: overrides.id,
    price: '1500',
    total_price: '1500',
    sell_amount: '100',
    buy_amount: '150000',
    fee: { total: '0', percent: '0' },
    expires_at: futureISO,
    context: 'sep24',
    anchorId: 'cowrie',
    anchorName: 'Cowrie',
    meetsFloor: true,
    expiredAt: new Date(futureISO),
    isExpired: false,
    netAmount: '150000',
    ...overrides,
  };
}

describe('solveMultiAnchor (#800)', () => {
  it('splits across anchors best-price first when the top anchor cannot fill alone', () => {
    const intent = createTestIntent({ sellAmount: '100' });
    const quotes = [
      createTestQuote({ id: 'b', anchorId: 'b', price: '1500', sell_amount: '100' }),
      createTestQuote({ id: 'a', anchorId: 'a', price: '1600', sell_amount: '60' }),
    ];

    const result = solveMultiAnchor(intent, quotes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.type).toBe('multi_anchor');
    expect(result.plan.legs).toHaveLength(2);
    // Best price (1600) fills its capacity (60) first, remainder (40) to next.
    expect(result.plan.legs[0]).toMatchObject({
      anchorId: 'a',
      sellAmount: '60',
      netAmount: '96000',
    });
    expect(result.plan.legs[1]).toMatchObject({
      anchorId: 'b',
      sellAmount: '40',
      netAmount: '60000',
    });
    expect(result.plan.totalSell).toBe('100');
    expect(result.plan.netAmount).toBe('156000');
  });

  it('returns a single leg when the best anchor covers the whole order', () => {
    const intent = createTestIntent({ sellAmount: '100' });
    const quotes = [
      createTestQuote({ id: 'a', anchorId: 'a', price: '1600', sell_amount: '100' }),
      createTestQuote({ id: 'b', anchorId: 'b', price: '1500', sell_amount: '100' }),
    ];

    const result = solveMultiAnchor(intent, quotes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.legs).toHaveLength(1);
    expect(result.plan.legs[0]).toMatchObject({ anchorId: 'a', sellAmount: '100' });
  });

  it('prorates the leg fee by the fraction of the quote consumed', () => {
    const intent = createTestIntent({ sellAmount: '50' });
    const quotes = [
      createTestQuote({ id: 'a', anchorId: 'a', sell_amount: '100', fee: { total: '10' } }),
    ];

    const result = solveMultiAnchor(intent, quotes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 50 of 100 consumed → half the fee.
    expect(result.plan.legs[0]?.fee).toBe('5');
  });

  it('respects maxAnchors and errors when the cap prevents a full fill', () => {
    const intent = createTestIntent({ sellAmount: '100' });
    const quotes = [
      createTestQuote({ id: 'a', anchorId: 'a', price: '1600', sell_amount: '60' }),
      createTestQuote({ id: 'b', anchorId: 'b', price: '1500', sell_amount: '100' }),
    ];

    const result = solveMultiAnchor(intent, quotes, { maxAnchors: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('insufficient_liquidity');
  });

  it('errors with insufficient_liquidity when combined capacity is below the order', () => {
    const intent = createTestIntent({ sellAmount: '100' });
    const quotes = [
      createTestQuote({ id: 'a', anchorId: 'a', sell_amount: '30' }),
      createTestQuote({ id: 'b', anchorId: 'b', sell_amount: '40' }),
    ];

    const result = solveMultiAnchor(intent, quotes);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('insufficient_liquidity');
  });

  it('errors with floor_not_met when the aggregate delivered misses the minimum', () => {
    const intent = createTestIntent({ sellAmount: '100', minReceive: '200000' });
    const quotes = [createTestQuote({ id: 'a', anchorId: 'a', price: '1500', sell_amount: '100' })];

    const result = solveMultiAnchor(intent, quotes);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('floor_not_met');
  });

  it('errors when there are no quotes or all are expired', () => {
    const intent = createTestIntent();
    expect(solveMultiAnchor(intent, []).ok).toBe(false);

    const expired = createTestQuote({
      id: 'x',
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    const result = solveMultiAnchor(intent, [expired]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('all_quotes_expired');
  });
});
