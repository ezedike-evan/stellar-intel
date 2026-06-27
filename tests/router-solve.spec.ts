import { describe, it, expect } from 'vitest';
import { solveSingleAnchor, throwIfNoRoute, NoEligibleRouteError } from '@/lib/router/solve';
import type { Intent, EvaluatedQuote } from '@/types';

// ─── Test utilities ───────────────────────────────────────────────────────────

/**
 * Factory function to create a minimal valid intent for testing.
 */
function createTestIntent(overrides?: Partial<Intent>): Intent {
  const nowISO = new Date().toISOString();
  const futureISO = new Date(Date.now() + 3600 * 1000).toISOString();

  return {
    version: 1,
    nonce: '550e8400e29b41d4a716446655440000',
    account: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789',
    corridor: 'usdc-ngn',
    sellAsset: { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4MY5KU4ERRJLSORRQ7ROVQA5SV6LQ34' },
    sellAmount: '100',
    buyAsset: { code: 'NGN' },
    minReceive: '1500', // floor: at least 1500 NGN
    deliveryHint: 'bank_account',
    deadline: futureISO,
    ...overrides,
  };
}

/**
 * Factory function to create a minimal valid SEP-38 quote for testing.
 */
function createTestQuote(overrides?: Partial<EvaluatedQuote>): EvaluatedQuote {
  const futureISO = new Date(Date.now() + 300 * 1000).toISOString(); // expires in 5 minutes

  return {
    id: 'quote-001',
    price: '1500',
    total_price: '1500',
    sell_amount: '100',
    buy_amount: '150000', // 100 USDC * 1500 NGN/USDC
    fee: {
      total: '0',
      percent: '0',
    },
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('solveSingleAnchor', () => {
  describe('Happy path: selecting the best quote', () => {
    it('returns a plan with the single best quote', () => {
      const intent = createTestIntent();
      const quotes = [createTestQuote()];

      const result = solveSingleAnchor(intent, quotes);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.anchorId).toBe('cowrie');
        expect(result.plan.quoteId).toBe('quote-001');
        expect(result.plan.netAmount).toBe('150000');
        expect(result.plan.type).toBe('single_anchor');
      }
    });

    it('selects the quote with the highest buy_amount among multiple valid quotes', () => {
      const intent = createTestIntent({ minReceive: '1500' });
      const futureISO = new Date(Date.now() + 300 * 1000).toISOString();

      const quotes = [
        createTestQuote({
          id: 'quote-001',
          anchorName: 'Anchor A',
          buy_amount: '150000',
          netAmount: '150000',
        }),
        createTestQuote({
          id: 'quote-002',
          anchorName: 'Anchor B',
          buy_amount: '152000', // higher amount
          netAmount: '152000',
          price: '1520',
          total_price: '1520',
        }),
        createTestQuote({
          id: 'quote-003',
          anchorName: 'Anchor C',
          buy_amount: '151000',
          netAmount: '151000',
          price: '1510',
          total_price: '1510',
        }),
      ];

      const result = solveSingleAnchor(intent, quotes);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.quoteId).toBe('quote-002');
        expect(result.plan.netAmount).toBe('152000');
        expect(result.plan.anchorName).toBe('Anchor B');
      }
    });
  });

  describe('Floor validation: skip quotes below minimum receive', () => {
    it('rejects quotes where buy_amount < minReceive', () => {
      const intent = createTestIntent({ minReceive: '160000' }); // floor is 160k
      const quotes = [
        createTestQuote({
          buy_amount: '150000', // below floor
          netAmount: '150000',
        }),
      ];

      const result = solveSingleAnchor(intent, quotes);

      expect(result.ok).toBe(false);
      if (!result.ok && result.error === 'floor_not_met') {
        expect(result.details).toContain('160000');
      }
    });

    it('skips quotes below floor and selects the best remaining quote', () => {
      const intent = createTestIntent({ minReceive: '151000' });
      const quotes = [
        createTestQuote({
          id: 'quote-001',
          anchorName: 'Too Low',
          buy_amount: '150000', // below floor
          netAmount: '150000',
        }),
        createTestQuote({
          id: 'quote-002',
          anchorName: 'Good Quote',
          buy_amount: '152000', // meets floor
          netAmount: '152000',
          price: '1520',
          total_price: '1520',
        }),
      ];

      const result = solveSingleAnchor(intent, quotes);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.quoteId).toBe('quote-002');
      }
    });

    it('returns floor_not_met when all quotes violate the minimum', () => {
      const intent = createTestIntent({ minReceive: '200000' });
      const quotes = [
        createTestQuote({
          anchorName: 'Cowrie',
          buy_amount: '150000',
          netAmount: '150000',
        }),
        createTestQuote({
          anchorName: 'Moneygram',
          buy_amount: '155000',
          netAmount: '155000',
        }),
      ];

      const result = solveSingleAnchor(intent, quotes);

      expect(result.ok).toBe(false);
      if (!result.ok && result.error === 'floor_not_met') {
        expect(result.details).toContain('No quotes meet minimum receive of 200000');
      }
    });
  });

  describe('Expiration: reject expired quotes and deadlines', () => {
    it('skips quotes that have expired', () => {
      const pastISO = new Date(Date.now() - 60 * 1000).toISOString(); // expired 1 min ago
      const futureISO = new Date(Date.now() + 300 * 1000).toISOString();

      const intent = createTestIntent();
      const quotes = [
        createTestQuote({
          id: 'quote-expired',
          anchorName: 'Expired Anchor',
          expires_at: pastISO,
        }),
        createTestQuote({
          id: 'quote-valid',
          anchorName: 'Valid Anchor',
          expires_at: futureISO,
        }),
      ];

      const result = solveSingleAnchor(intent, quotes);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.quoteId).toBe('quote-valid');
      }
    });

    it('returns all_quotes_expired when every quote has expired', () => {
      const pastISO = new Date(Date.now() - 60 * 1000).toISOString();
      const intent = createTestIntent();
      const quotes = [
        createTestQuote({
          anchorName: 'Anchor A',
          expires_at: pastISO,
        }),
        createTestQuote({
          anchorName: 'Anchor B',
          expires_at: pastISO,
        }),
      ];

      const result = solveSingleAnchor(intent, quotes);

      expect(result.ok).toBe(false);
      if (!result.ok && result.error === 'all_quotes_expired') {
        expect(result.details).toContain('2 quote(s) have expired');
      }
    });

    it('rejects intent when deadline has already passed', () => {
      const pastISO = new Date(Date.now() - 60 * 1000).toISOString();
      const intent = createTestIntent({ deadline: pastISO });
      const quotes = [createTestQuote()];

      const result = solveSingleAnchor(intent, quotes);

      expect(result.ok).toBe(false);
      if (!result.ok && result.error === 'all_quotes_expired') {
        expect(result.details).toContain('deadline');
      }
    });
  });

  describe('No eligible route errors', () => {
    it('returns no_eligible_route when quote array is empty', () => {
      const intent = createTestIntent();
      const result = solveSingleAnchor(intent, []);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('no_eligible_route');
      }
    });

    it('combines expiration and floor errors appropriately', () => {
      const pastISO = new Date(Date.now() - 60 * 1000).toISOString();
      const futureISO = new Date(Date.now() + 300 * 1000).toISOString();

      const intent = createTestIntent({ minReceive: '200000' });
      const quotes = [
        createTestQuote({
          anchorName: 'Expired A',
          expires_at: pastISO,
        }),
        createTestQuote({
          anchorName: 'Below Floor',
          buy_amount: '150000',
          netAmount: '150000',
          expires_at: futureISO,
        }),
      ];

      const result = solveSingleAnchor(intent, quotes);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // When we have floor violations, we should prefer that error
        expect(result.error).toBe('floor_not_met');
      }
    });
  });

  describe('Determinism and edge cases', () => {
    it('returns consistent results for identical inputs', () => {
      const intent = createTestIntent();
      const quotes = [
        createTestQuote({
          id: 'quote-001',
          anchorName: 'Anchor A',
          buy_amount: '150000',
        }),
        createTestQuote({
          id: 'quote-002',
          anchorName: 'Anchor B',
          buy_amount: '152000',
        }),
      ];

      const result1 = solveSingleAnchor(intent, quotes);
      const result2 = solveSingleAnchor(intent, quotes);

      expect(result1).toEqual(result2);
    });

    it('handles decimal string comparisons correctly', () => {
      const intent = createTestIntent({ minReceive: '150000' });
      const quotes = [
        createTestQuote({
          id: 'quote-001',
          buy_amount: '150000.00', // equal to floor (as decimal string)
          netAmount: '150000.00',
        }),
        createTestQuote({
          id: 'quote-002',
          buy_amount: '149999.99', // just below floor
          netAmount: '149999.99',
        }),
      ];

      const result = solveSingleAnchor(intent, quotes);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.quoteId).toBe('quote-001');
      }
    });

    it('handles scientific notation in decimal strings', () => {
      const intent = createTestIntent({ minReceive: '1e3' }); // 1000 in scientific notation
      const quotes = [
        createTestQuote({
          buy_amount: '1.5e3', // 1500
          netAmount: '1.5e3',
        }),
      ];

      const result = solveSingleAnchor(intent, quotes);

      expect(result.ok).toBe(true);
    });
  });

  describe('Plan structure and fields', () => {
    it('uses the quote fee as the plan fee', () => {
      const intent = createTestIntent();
      const quotes = [
        createTestQuote({
          fee: {
            total: '5',
            percent: '0.5',
          },
        }),
      ];

      const result = solveSingleAnchor(intent, quotes);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.fee).toBe('5');
      }
    });

    it('includes the exchange rate (price) in the plan', () => {
      const intent = createTestIntent();
      const quotes = [
        createTestQuote({
          price: '1520.50',
        }),
      ];

      const result = solveSingleAnchor(intent, quotes);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.price).toBe('1520.50');
      }
    });
  });
});

// ─── Error handling: throwIfNoRoute ───────────────────────────────────────────

describe('throwIfNoRoute', () => {
  it('returns the plan when result.ok is true', () => {
    const intent = createTestIntent();
    const quotes = [createTestQuote()];
    const result = solveSingleAnchor(intent, quotes);

    const plan = throwIfNoRoute(result);

    expect(plan.type).toBe('single_anchor');
    expect(plan.quoteId).toBe('quote-001');
  });

  it('throws NoEligibleRouteError with code when result.ok is false', () => {
    const intent = createTestIntent({ minReceive: '200000' });
    const quotes = [createTestQuote({ buy_amount: '150000', netAmount: '150000' })];
    const result = solveSingleAnchor(intent, quotes);

    expect(() => throwIfNoRoute(result)).toThrow(NoEligibleRouteError);

    try {
      throwIfNoRoute(result);
    } catch (e) {
      if (e instanceof NoEligibleRouteError) {
        expect(e.code).toBe('floor_not_met');
        expect(e.message).toContain('floor_not_met');
      }
    }
  });

  it('includes details in the error message when available', () => {
    const intent = createTestIntent({ minReceive: '200000' });
    const quotes = [createTestQuote({ buy_amount: '150000', netAmount: '150000' })];
    const result = solveSingleAnchor(intent, quotes);

    try {
      throwIfNoRoute(result);
    } catch (e) {
      if (e instanceof NoEligibleRouteError) {
        expect(e.message).toContain('200000');
      }
    }
  });
});
