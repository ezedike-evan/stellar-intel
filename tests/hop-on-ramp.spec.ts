import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/stellar/anchors', () => ({
  getResolvedAnchorById: vi.fn(),
}));

vi.mock('@/lib/stellar/sep24', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/sep24')>('@/lib/stellar/sep24');
  return {
    ...actual,
    fetchAnchorFee: vi.fn(),
    initiateDeposit: vi.fn(),
  };
});

import * as anchors from '@/lib/stellar/anchors';
import * as sep24 from '@/lib/stellar/sep24';
import { createOnRampHop } from '@/lib/router/connectors/on-ramp';
import type { HopAsset, HopStep } from '@/types';

const mockGetResolvedAnchorById = vi.mocked(anchors.getResolvedAnchorById);
const mockFetchAnchorFee = vi.mocked(sep24.fetchAnchorFee);
const mockInitiateDeposit = vi.mocked(sep24.initiateDeposit);

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

const NGN_INPUT: HopAsset = { asset: 'iso4217:NGN', amount: '150000' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createOnRampHop', () => {
  it('plans a deposit using the anchor SEP-24 deposit fee schedule', async () => {
    mockGetResolvedAnchorById.mockResolvedValue(RESOLVED_ANCHOR);
    mockFetchAnchorFee.mockResolvedValue({
      fee: '500',
      anchorDomain: RESOLVED_ANCHOR.homeDomain,
      exchangeRate: 1 / 1500, // NGN -> USDC
    });

    const hop = createOnRampHop({
      anchorId: 'moneygram',
      account: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ',
      jwt: 'test-jwt',
    });

    const result = await hop.plan(NGN_INPUT, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.step.hopType).toBe('on-ramp');
    expect(result.step.input).toEqual(NGN_INPUT);
    expect(result.step.output.asset).toBe(
      `stellar:${RESOLVED_ANCHOR.assetCode}:${RESOLVED_ANCHOR.assetIssuer}`
    );
    // (150000 - 500) / 1500 = 99.666...
    expect(Number(result.step.output.amount)).toBeCloseTo(99.6667, 3);
    expect(mockFetchAnchorFee).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'deposit', amount: '150000' })
    );
  });

  it('fails planning when the anchor reports a zero exchange rate', async () => {
    mockGetResolvedAnchorById.mockResolvedValue(RESOLVED_ANCHOR);
    mockFetchAnchorFee.mockResolvedValue({
      fee: '500',
      anchorDomain: RESOLVED_ANCHOR.homeDomain,
      exchangeRate: 0,
    });

    const hop = createOnRampHop({
      anchorId: 'moneygram',
      account: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ',
      jwt: 'test-jwt',
    });

    const result = await hop.plan(NGN_INPUT, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('no_exchange_rate');
  });

  it('fails planning when anchor resolution throws', async () => {
    mockGetResolvedAnchorById.mockRejectedValue(new Error('DNS resolution failed'));

    const hop = createOnRampHop({
      anchorId: 'moneygram',
      account: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ',
      jwt: 'test-jwt',
    });

    const result = await hop.plan(NGN_INPUT, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('anchor_resolution_failed');
  });

  it('executes by opening the anchor interactive deposit session', async () => {
    mockGetResolvedAnchorById.mockResolvedValue(RESOLVED_ANCHOR);
    mockInitiateDeposit.mockResolvedValue({
      type: 'interactive_customer_info_needed',
      url: 'https://stellar.moneygram.com/kyc/session',
      id: 'deposit-tx-1',
    });

    const hop = createOnRampHop({
      anchorId: 'moneygram',
      account: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ',
      jwt: 'test-jwt',
    });

    const step: HopStep = {
      hopType: 'on-ramp',
      hopId: 'moneygram-on-ramp',
      input: NGN_INPUT,
      output: { asset: 'stellar:USDC:GISSUER', amount: '99.6666667' },
      details: { anchorId: 'moneygram' },
    };

    const result = await hop.execute(step, {});
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
    mockGetResolvedAnchorById.mockResolvedValue(RESOLVED_ANCHOR);
    mockInitiateDeposit.mockRejectedValue(new Error('anchor unavailable'));

    const hop = createOnRampHop({
      anchorId: 'moneygram',
      account: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ',
      jwt: 'test-jwt',
    });

    const step: HopStep = {
      hopType: 'on-ramp',
      hopId: 'moneygram-on-ramp',
      input: NGN_INPUT,
      output: { asset: 'stellar:USDC:GISSUER', amount: '99.6666667' },
      details: { anchorId: 'moneygram' },
    };

    const result = await hop.execute(step, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('deposit_initiation_failed');
  });

  it('fails execution when the step was not planned by this connector', async () => {
    const hop = createOnRampHop({
      anchorId: 'moneygram',
      account: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ',
      jwt: 'test-jwt',
    });

    const step: HopStep = {
      hopType: 'on-ramp',
      hopId: 'moneygram-on-ramp',
      input: NGN_INPUT,
      output: { asset: 'stellar:USDC:GISSUER', amount: '99.6666667' },
      details: {}, // no anchorId — as if planned by a different anchor's instance, or not planned at all
    };

    const result = await hop.execute(step, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('missing_planned_anchor');
    expect(mockGetResolvedAnchorById).not.toHaveBeenCalled();
    expect(mockInitiateDeposit).not.toHaveBeenCalled();
  });
});
