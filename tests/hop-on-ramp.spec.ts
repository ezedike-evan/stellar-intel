import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/stellar/anchors', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/stellar/anchors')>('@/lib/stellar/anchors');
  return {
    ...actual,
    getResolvedAnchorById: vi.fn(),
    getAnchorsByCorridorId: vi.fn(),
    getCorridorById: vi.fn(),
  };
});

vi.mock('@/lib/stellar/sep1', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/sep1')>('@/lib/stellar/sep1');
  return {
    ...actual,
    resolveAnchor: vi.fn(),
  };
});

vi.mock('@/lib/stellar/sep24', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/sep24')>('@/lib/stellar/sep24');
  return {
    ...actual,
    getSep24Info: vi.fn(),
    initiateDeposit: vi.fn(),
  };
});

vi.mock('@/lib/fx/reference-mid', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/fx/reference-mid')>('@/lib/fx/reference-mid');
  return {
    ...actual,
    referenceMidPrice: vi.fn(),
  };
});

vi.mock('@/lib/stellar/deposit-rates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/deposit-rates')>(
    '@/lib/stellar/deposit-rates'
  );
  return {
    ...actual,
    estimateDepositForAnchor: vi.fn(),
  };
});

import * as anchors from '@/lib/stellar/anchors';
import * as sep1 from '@/lib/stellar/sep1';
import * as sep24 from '@/lib/stellar/sep24';
import * as referenceMid from '@/lib/fx/reference-mid';
import * as depositRates from '@/lib/stellar/deposit-rates';
import { fetchDepositRates } from '@/lib/stellar/deposit-rates';
import { createOnRampHop } from '@/lib/router/connectors/on-ramp';
import type { Corridor, DepositRate, HopAsset, HopStep, Sep1TomlData } from '@/types';

// The real estimator, to delegate the module mock to: the hop is exercised
// against the actual engine, over the mocked network tiers above.
const actualDepositRates = await vi.importActual<typeof import('@/lib/stellar/deposit-rates')>(
  '@/lib/stellar/deposit-rates'
);

const mockGetResolvedAnchorById = vi.mocked(anchors.getResolvedAnchorById);
const mockGetAnchorsByCorridorId = vi.mocked(anchors.getAnchorsByCorridorId);
const mockGetCorridorById = vi.mocked(anchors.getCorridorById);
const mockResolveAnchor = vi.mocked(sep1.resolveAnchor);
const mockGetSep24Info = vi.mocked(sep24.getSep24Info);
const mockInitiateDeposit = vi.mocked(sep24.initiateDeposit);
const mockReferenceMidPrice = vi.mocked(referenceMid.referenceMidPrice);
const mockEstimateDepositForAnchor = vi.mocked(depositRates.estimateDepositForAnchor);

const RESOLVED_ANCHOR = {
  id: 'moneygram',
  name: 'MoneyGram',
  homeDomain: 'stellar.moneygram.com',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  TRANSFER_SERVER_SEP0024: 'https://stellar.moneygram.com/sep24',
  WEB_AUTH_ENDPOINT: 'https://stellar.moneygram.com/auth',
  SIGNING_KEY: 'G...',
  capabilities: { sep10: true, sep24: true, sep38: false, sep12: false },
  domain: 'stellar.moneygram.com',
  ANCHOR_QUOTE_SERVER: null,
  NETWORK_PASSPHRASE: null,
  ORG_URL: null,
  ORG_SUPPORT_EMAIL: null,
  ORG_SUPPORT_URL: null,
  CURRENCIES: [],
};

const USDC_ID = `stellar:${RESOLVED_ANCHOR.assetCode}:${RESOLVED_ANCHOR.assetIssuer}`;

const CORRIDOR: Corridor = {
  id: 'usdc-ngn',
  from: 'USDC',
  fromIssuer: RESOLVED_ANCHOR.assetIssuer,
  fromPeg: 'USD',
  to: 'NGN',
  countryCode: 'NG',
  countryName: 'Nigeria',
};

const NGN_INPUT: HopAsset = { asset: 'iso4217:NGN', amount: '150000' };

function makeHop() {
  return createOnRampHop({
    anchorId: 'moneygram',
    account: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ',
    jwt: 'test-jwt',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy path: the real estimator over mocked TOML / /info /
  // reference-price tiers. 150000 NGN ÷ 1500 = 100 USDC gross, minus the
  // anchor's flat 0.5 USDC deposit fee = 99.5 USDC.
  mockEstimateDepositForAnchor.mockImplementation(actualDepositRates.estimateDepositForAnchor);
  mockGetResolvedAnchorById.mockResolvedValue(RESOLVED_ANCHOR);
  mockResolveAnchor.mockResolvedValue({
    TRANSFER_SERVER_SEP0024: 'https://stellar.moneygram.com/sep24',
  } as Sep1TomlData);
  mockGetSep24Info.mockResolvedValue({
    deposit: { [USDC_ID]: { enabled: true, fee_fixed: 0.5 } },
    withdraw: {},
    fee: { enabled: true },
    transaction: { enabled: true },
    transactions: { enabled: true },
  });
  mockReferenceMidPrice.mockResolvedValue({
    price: 1500, // NGN per 1 USDC
    source: 'fx',
    detail: 'USDC treated as 1 USD × open.er-api USD→NGN',
  });
  mockGetCorridorById.mockImplementation((id: string) => {
    if (id === CORRIDOR.id) return CORRIDOR;
    throw new Error(`Unknown corridor: ${id}`);
  });
  mockGetAnchorsByCorridorId.mockReturnValue([RESOLVED_ANCHOR]);
});

describe('createOnRampHop', () => {
  it('plans a deposit through the shared deposit estimate engine', async () => {
    const hop = makeHop();

    const result = await hop.plan(NGN_INPUT, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.step.hopType).toBe('on-ramp');
    expect(result.step.input).toEqual(NGN_INPUT);
    expect(result.step.output.asset).toBe(USDC_ID);
    expect(Number(result.step.output.amount)).toBeCloseTo(99.5, 6);
    expect(result.step.details).toMatchObject({
      anchorId: 'moneygram',
      fee: 0.5,
      source: 'sep24-fee',
      referenceSource: 'USDC treated as 1 USD × open.er-api USD→NGN',
    });
    expect(mockEstimateDepositForAnchor).toHaveBeenCalledWith(
      RESOLVED_ANCHOR,
      { code: 'USDC', issuer: RESOLVED_ANCHOR.assetIssuer },
      'NGN',
      '150000',
      expect.objectContaining({ type: 'bank_account' })
    );
  });

  it('plans from whatever DepositRate the estimator returns', async () => {
    const rate: DepositRate = {
      anchorId: 'moneygram',
      anchorName: 'MoneyGram',
      corridorId: 'usdc-ngn',
      asset: USDC_ID,
      fiatAmount: 150000,
      fee: null,
      feeType: 'flat',
      exchangeRate: 100 / 150000,
      totalReceived: 100,
      source: 'sep24-fee',
      referenceSource: 'stubbed reference',
      updatedAt: new Date(),
    };
    mockEstimateDepositForAnchor.mockResolvedValueOnce(rate);

    const result = await makeHop().plan(NGN_INPUT, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.step.output.amount).toBe('100.0000000');
    expect(result.step.details['referenceSource']).toBe('stubbed reference');
  });

  it('agrees with fetchDepositRates for the same anchor and amount', async () => {
    const hopResult = await makeHop().plan(NGN_INPUT, {});
    const comparison = await fetchDepositRates('usdc-ngn', '150000');

    expect(hopResult.ok).toBe(true);
    if (!hopResult.ok) return;
    expect(comparison.rates).toHaveLength(1);
    expect(Number(hopResult.step.output.amount)).toBeCloseTo(
      comparison.rates[0]!.totalReceived ?? NaN,
      6
    );
  });

  it('agrees with fetchDepositRates when the anchor keys /info by bare asset code', async () => {
    mockGetSep24Info.mockResolvedValue({
      deposit: { USDC: { enabled: true, fee_fixed: 0.5 } },
      withdraw: {},
      fee: { enabled: true },
      transaction: { enabled: true },
      transactions: { enabled: true },
    });

    const hopResult = await makeHop().plan(NGN_INPUT, {});
    const comparison = await fetchDepositRates('usdc-ngn', '150000');

    expect(hopResult.ok).toBe(true);
    if (!hopResult.ok) return;
    expect(comparison.errors).toEqual([]);
    expect(comparison.rates).toHaveLength(1);
    expect(comparison.rates[0]!.asset).toBe(USDC_ID);
    expect(hopResult.step.output.asset).toBe(USDC_ID);
    expect(Number(hopResult.step.output.amount)).toBeCloseTo(
      comparison.rates[0]!.totalReceived ?? NaN,
      6
    );
  });

  it('fails planning with amount_too_small for an amount that is not a positive number', async () => {
    const result = await makeHop().plan({ asset: 'iso4217:NGN', amount: '0' }, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('amount_too_small');
  });

  it('fails planning with no_exchange_rate when no reference price exists', async () => {
    mockReferenceMidPrice.mockRejectedValue(
      new Error(
        'reference mid unavailable: the SDEX order book against USDC is empty on both sides'
      )
    );

    const result = await makeHop().plan(NGN_INPUT, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('no_exchange_rate');
  });

  it('fails planning with fee_lookup_failed when the anchor /info is unusable', async () => {
    mockGetSep24Info.mockRejectedValue(new Error('HTTP 500 from /info'));

    const result = await makeHop().plan(NGN_INPUT, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('fee_lookup_failed');
  });

  it('fails planning with amount_too_small when fees swallow the deposit', async () => {
    mockGetSep24Info.mockResolvedValue({
      deposit: { [USDC_ID]: { enabled: true, fee_fixed: 200 } }, // > 100 USDC gross
      withdraw: {},
      fee: { enabled: true },
      transaction: { enabled: true },
      transactions: { enabled: true },
    });

    const result = await makeHop().plan(NGN_INPUT, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('amount_too_small');
  });

  it('fails planning when anchor resolution throws', async () => {
    mockGetResolvedAnchorById.mockRejectedValue(new Error('DNS resolution failed'));

    const result = await makeHop().plan(NGN_INPUT, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('anchor_resolution_failed');
  });

  it('executes by opening the anchor interactive deposit session', async () => {
    mockInitiateDeposit.mockResolvedValue({
      type: 'interactive_customer_info_needed',
      url: 'https://stellar.moneygram.com/kyc/session',
      id: 'deposit-tx-1',
    });

    const step: HopStep = {
      hopType: 'on-ramp',
      hopId: 'moneygram-on-ramp',
      input: NGN_INPUT,
      output: { asset: 'stellar:USDC:GISSUER', amount: '99.5000000' },
      details: { anchorId: 'moneygram' },
    };

    const result = await makeHop().execute(step, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.txRef).toBe('deposit-tx-1');
    expect(result.output).toEqual(step.output);
    expect(mockInitiateDeposit).toHaveBeenCalledWith(
      RESOLVED_ANCHOR,
      expect.objectContaining({ account: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ', amount: '150000' })
    );
  });

  it('fails execution when deposit initiation throws', async () => {
    mockInitiateDeposit.mockRejectedValue(new Error('anchor unavailable'));

    const step: HopStep = {
      hopType: 'on-ramp',
      hopId: 'moneygram-on-ramp',
      input: NGN_INPUT,
      output: { asset: 'stellar:USDC:GISSUER', amount: '99.5000000' },
      details: { anchorId: 'moneygram' },
    };

    const result = await makeHop().execute(step, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('deposit_initiation_failed');
  });

  it('fails execution when the step was not planned by this connector', async () => {
    const step: HopStep = {
      hopType: 'on-ramp',
      hopId: 'moneygram-on-ramp',
      input: NGN_INPUT,
      output: { asset: 'stellar:USDC:GISSUER', amount: '99.5000000' },
      details: {}, // no anchorId — as if planned by a different anchor's instance, or not planned at all
    };

    const result = await makeHop().execute(step, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('missing_planned_anchor');
    expect(mockGetResolvedAnchorById).not.toHaveBeenCalled();
    expect(mockInitiateDeposit).not.toHaveBeenCalled();
  });
});
