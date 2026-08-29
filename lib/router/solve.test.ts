import { describe, expect, it } from 'vitest';
import { solveSingleAnchor } from '@/lib/router/solve';
import type { EvaluatedQuote, Intent } from '@/types';

function createIntent(overrides: Partial<Intent> = {}): Intent {
  return {
    version: 1,
    nonce: '550e8400e29b41d4a716446655440000',
    account: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789',
    corridor: 'usdc-ngn',
    sellAsset: {
      code: 'USDC',
      issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4MY5KU4ERRJLSORRQ7ROVQA5SV6LQ34',
    },
    sellAmount: '100',
    buyAsset: { code: 'NGN' },
    minReceive: '100000',
    deliveryHint: 'bank_account',
    deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function createQuote(
  anchorId: string,
  buyAmount: string,
  overrides: Partial<EvaluatedQuote> = {}
): EvaluatedQuote {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  return {
    id: `quote-${anchorId}`,
    price: '1500',
    total_price: '1500',
    sell_amount: '100',
    buy_amount: buyAmount,
    fee: { total: '0', percent: '0' },
    expires_at: expiresAt,
    context: 'sep24',
    anchorId,
    anchorName: anchorId,
    meetsFloor: true,
    expiredAt: new Date(expiresAt),
    isExpired: false,
    netAmount: buyAmount,
    ...overrides,
  };
}

type AnchorMetric = {
  reliability: number;
  latencyMs: number;
  reputationComposite: number;
};

function scoring(metrics: Record<string, AnchorMetric>) {
  return { anchorMetrics: metrics };
}

describe('scored router selection', () => {
  it('selects the only anchor in a single-anchor corridor', () => {
    const quote = createQuote('only-anchor', '150000');

    const result = solveSingleAnchor(
      createIntent({ minReceive: '100000' }),
      [quote],
      undefined,
      scoring({
        'only-anchor': {
          reliability: 0.8,
          latencyMs: 120,
          reputationComposite: 0.8,
        },
      }),
      'scored'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.anchorId).toBe('only-anchor');
      expect(result.plan.quoteId).toBe('quote-only-anchor');
    }
  });

  it('breaks an otherwise equal quote tie using the stronger anchor score', () => {
    const quotes = [
      createQuote('lower-reputation', '150000'),
      createQuote('higher-reputation', '150000'),
    ];

    const result = solveSingleAnchor(
      createIntent(),
      quotes,
      undefined,
      scoring({
        'lower-reputation': {
          reliability: 0.7,
          latencyMs: 400,
          reputationComposite: 0.4,
        },
        'higher-reputation': {
          reliability: 0.7,
          latencyMs: 400,
          reputationComposite: 0.9,
        },
      }),
      'scored'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.anchorId).toBe('higher-reputation');
      expect(result.plan.quoteId).toBe('quote-higher-reputation');
    }
  });

  it('excludes an anchor below the reputation threshold', () => {
    const quotes = [
      createQuote('degraded-anchor', '160000'),
      createQuote('healthy-anchor', '150000'),
    ];

    const result = solveSingleAnchor(
      createIntent(),
      quotes,
      undefined,
      scoring({
        'degraded-anchor': {
          reliability: 0.95,
          latencyMs: 20,
          reputationComposite: 0.05,
        },
        'healthy-anchor': {
          reliability: 0.8,
          latencyMs: 120,
          reputationComposite: 0.8,
        },
      }),
      'scored'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.anchorId).toBe('healthy-anchor');
      expect(result.plan.quoteId).toBe('quote-healthy-anchor');
    }
  });
});
