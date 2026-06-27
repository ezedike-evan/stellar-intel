import { describe, it, expect } from 'vitest';
import { computeRateComparison } from '@/lib/stellar/sep24';
import { computeTotalReceived } from '@/lib/utils';
import type { AnchorRate } from '@/types';

type QuoteScenario = {
  name: string;
  amount: number;
  quotes: Array<{
    anchorId: string;
    fee: number;
    feePercent: number;
    exchangeRate: number;
    status?: 'fulfilled' | 'rejected';
    reason?: Error;
  }>;
  expectedBestRateId: string;
  expectedFulfilledCount: number;
};

function buildQuoteResult(
  amount: number,
  anchorId: string,
  fee: number,
  feePercent: number,
  exchangeRate: number,
  status: 'fulfilled' | 'rejected' = 'fulfilled',
  reason: Error = new Error('quote unavailable')
): PromiseSettledResult<AnchorRate> {
  if (status === 'fulfilled') {
    return {
      status: 'fulfilled',
      value: {
        anchorId,
        anchorName: `Anchor ${anchorId}`,
        corridorId: 'usdc-ngn',
        fee,
        feeType: feePercent > 0 ? 'combined' : 'flat',
        exchangeRate,
        totalReceived: computeTotalReceived(amount, fee, feePercent, exchangeRate),
        source: 'sep24-fee',
        updatedAt: new Date(),
      },
    };
  }

  return {
    status: 'rejected',
    reason,
  };
}

const scenarios: QuoteScenario[] = [
  {
    name: 'selects the anchor with the highest totalReceived',
    amount: 100,
    quotes: [
      { anchorId: 'a', fee: 3, feePercent: 0, exchangeRate: 1580 },
      { anchorId: 'b', fee: 1.5, feePercent: 0, exchangeRate: 1580 },
      { anchorId: 'c', fee: 4, feePercent: 0, exchangeRate: 1600 },
    ],
    expectedBestRateId: 'b',
    expectedFulfilledCount: 3,
  },
  {
    name: 'breaks ties deterministically by preserving input order',
    amount: 100,
    quotes: [
      { anchorId: 'a', fee: 2, feePercent: 0, exchangeRate: 1580 },
      { anchorId: 'b', fee: 2, feePercent: 0, exchangeRate: 1580 },
      { anchorId: 'c', fee: 2, feePercent: 0, exchangeRate: 1580 },
    ],
    expectedBestRateId: 'a',
    expectedFulfilledCount: 3,
  },
  {
    name: 'ignores a floor-miss quote and selects the next best anchor',
    amount: 10,
    quotes: [
      {
        anchorId: 'a',
        fee: 1,
        feePercent: 0,
        exchangeRate: 1580,
        status: 'rejected',
        reason: new Error('too_small'),
      },
      { anchorId: 'b', fee: 0.5, feePercent: 0, exchangeRate: 1580 },
      { anchorId: 'c', fee: 3, feePercent: 0, exchangeRate: 1600 },
    ],
    expectedBestRateId: 'b',
    expectedFulfilledCount: 2,
  },
  {
    name: 'ignores a budget-miss quote and selects available anchors',
    amount: 1000,
    quotes: [
      {
        anchorId: 'a',
        fee: 10,
        feePercent: 0,
        exchangeRate: 1500,
        status: 'rejected',
        reason: new Error('too_large'),
      },
      { anchorId: 'b', fee: 5, feePercent: 0, exchangeRate: 1490 },
      { anchorId: 'c', fee: 7.5, feePercent: 0, exchangeRate: 1510 },
    ],
    expectedBestRateId: 'c',
    expectedFulfilledCount: 2,
  },
  {
    name: 'returns empty bestRateId when all quotes miss floor or budget',
    amount: 50,
    quotes: [
      {
        anchorId: 'a',
        fee: 1,
        feePercent: 0,
        exchangeRate: 1580,
        status: 'rejected',
        reason: new Error('too_small'),
      },
      {
        anchorId: 'b',
        fee: 2,
        feePercent: 0,
        exchangeRate: 1580,
        status: 'rejected',
        reason: new Error('too_small'),
      },
    ],
    expectedBestRateId: '',
    expectedFulfilledCount: 0,
  },
  {
    name: 'prefers higher exchange rate even with a larger flat fee',
    amount: 100,
    quotes: [
      { anchorId: 'a', fee: 1, feePercent: 0, exchangeRate: 1500 },
      { anchorId: 'b', fee: 3, feePercent: 0, exchangeRate: 1585 },
    ],
    expectedBestRateId: 'b',
    expectedFulfilledCount: 2,
  },
  {
    name: 'prefers smaller percentage fee over larger flat fee when totalReceived is greater',
    amount: 100,
    quotes: [
      { anchorId: 'a', fee: 1, feePercent: 2, exchangeRate: 1580 },
      { anchorId: 'b', fee: 3, feePercent: 0, exchangeRate: 1580 },
    ],
    expectedBestRateId: 'a',
    expectedFulfilledCount: 2,
  },
  {
    name: 'handles identical totalReceived values by selecting the first matching anchor',
    amount: 100,
    quotes: [
      { anchorId: 'a', fee: 2, feePercent: 0, exchangeRate: 1580, status: 'fulfilled' },
      { anchorId: 'b', fee: 2, feePercent: 0, exchangeRate: 1580, status: 'fulfilled' },
    ],
    expectedBestRateId: 'a',
    expectedFulfilledCount: 2,
  },
  {
    name: 'resolves a complex bid with multiple anchors and rejects',
    amount: 250,
    quotes: [
      { anchorId: 'a', fee: 2.5, feePercent: 1, exchangeRate: 1570 },
      { anchorId: 'b', fee: 0.5, feePercent: 3, exchangeRate: 1590 },
      {
        anchorId: 'c',
        fee: 6,
        feePercent: 0,
        exchangeRate: 1600,
        status: 'rejected',
        reason: new Error('quote unavailable'),
      },
    ],
    expectedBestRateId: 'b',
    expectedFulfilledCount: 2,
  },
  {
    name: 'prefers a positive quote over a non-paying quote with zero totalReceived',
    amount: 100,
    quotes: [
      { anchorId: 'a', fee: 101, feePercent: 0, exchangeRate: 1580 },
      { anchorId: 'b', fee: 1, feePercent: 0, exchangeRate: 1570 },
    ],
    expectedBestRateId: 'b',
    expectedFulfilledCount: 2,
  },
  {
    name: 'selects the same best anchor from reordered input quotes',
    amount: 120,
    quotes: [
      { anchorId: 'c', fee: 4, feePercent: 0, exchangeRate: 1585 },
      { anchorId: 'a', fee: 1, feePercent: 0, exchangeRate: 1570 },
      { anchorId: 'b', fee: 2, feePercent: 0, exchangeRate: 1580 },
    ],
    expectedBestRateId: 'a',
    expectedFulfilledCount: 3,
  },
];

describe('router solver synthetic quote scenarios', () => {
  scenarios.forEach((scenario) => {
    it(`${scenario.name}`, () => {
      const results = scenario.quotes.map((quote) =>
        buildQuoteResult(
          scenario.amount,
          quote.anchorId,
          quote.fee,
          quote.feePercent,
          quote.exchangeRate,
          quote.status ?? 'fulfilled',
          quote.reason
        )
      );

      const comparison = computeRateComparison(results, 'usdc-ngn');

      expect(comparison.rates).toHaveLength(scenario.expectedFulfilledCount);
      expect(comparison.bestRateId).toBe(scenario.expectedBestRateId);

      if (scenario.expectedBestRateId) {
        const bestRate = comparison.rates.find(
          (rate) => rate.anchorId === scenario.expectedBestRateId
        );
        expect(bestRate).toBeDefined();
      }
    });
  });
});
