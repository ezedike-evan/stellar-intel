/**
 * Fixtures for the /onramp browser spec (tests/e2e/onramp.spec.ts): two anchors'
 * deposit quotes as GET /api/v1/onramp/quote answers them, and a SEP-24 deposit's
 * /transaction poll sequence, from "pay the anchor" through to credited.
 */

export const ONRAMP_E2E_TRANSFER_SERVER = 'https://anchor.onramp.test/sep24';
export const ONRAMP_E2E_TRANSACTION_ID = 'onramp-e2e-dep-1';
export const ONRAMP_E2E_JWT = 'onramp-e2e-jwt';
export const ONRAMP_E2E_NONCE = 'onramp-e2e-nonce';
export const ONRAMP_E2E_STELLAR_TX = 'c'.repeat(64);

const USDC = 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

/** What GET /api/v1/onramp/quote?corridor=usdc-ngn&amount=10000 returns for two anchors. */
export const onrampQuoteResponse = {
  corridorId: 'usdc-ngn',
  direction: 'deposit',
  bestRateId: 'cowrie',
  errors: [],
  rates: [
    {
      anchorId: 'cowrie',
      anchorName: 'Cowrie',
      corridorId: 'usdc-ngn',
      asset: USDC,
      fiatAmount: 10000,
      assetAmount: 6.45,
      fee: 0.5,
      feeType: 'flat',
      exchangeRate: 0.000595,
      totalReceived: 5.95,
      source: 'sep24-fee',
      updatedAt: '2026-10-25T08:00:00.000Z',
    },
    {
      anchorId: 'moneygram',
      anchorName: 'MoneyGram',
      corridorId: 'usdc-ngn',
      asset: USDC,
      fiatAmount: 10000,
      assetAmount: 6.45,
      fee: 1.2,
      feeType: 'flat',
      exchangeRate: 0.000525,
      totalReceived: 5.25,
      source: 'sep24-fee',
      updatedAt: '2026-10-25T08:00:00.000Z',
    },
  ],
  indicative: true,
  disclaimer: 'Estimate only. The anchor sets the final rate in its deposit window.',
};

export const ONRAMP_E2E_BANK_REFERENCE = 'REF-ONR-8841';

function transaction(status: string, extra: Record<string, unknown> = {}) {
  return {
    transaction: {
      id: ONRAMP_E2E_TRANSACTION_ID,
      kind: 'deposit',
      status,
      amount_in: '10000',
      amount_in_asset: 'iso4217:NGN',
      amount_out: '5.95',
      amount_out_asset: USDC,
      amount_fee: '0.50',
      started_at: '2026-10-25T08:00:00Z',
      ...extra,
    },
  };
}

/** The user still has to pay: the anchor's instructions are shown. */
export const depositAwaitingPayment = transaction('pending_user_transfer_start', {
  instructions: {
    'organization.bank_number': { value: '0123456789', description: 'Bank account number' },
    'organization.reference': {
      value: ONRAMP_E2E_BANK_REFERENCE,
      description: 'Payment reference',
    },
  },
  more_info_url: 'https://anchor.onramp.test/tx/onramp-e2e-dep-1',
});

/** Fiat received; the anchor is sending the asset. */
export const depositSending = transaction('pending_stellar');

/** Credited on Stellar. */
export const depositCompleted = transaction('completed', {
  stellar_transaction_id: ONRAMP_E2E_STELLAR_TX,
});

export const depositPollSequence = [depositAwaitingPayment, depositSending, depositCompleted];
