/**
 * Fixture data for SEP-24 interactive withdraw E2E execution tests.
 *
 * Simulates a full interactive USDC → NGN withdraw corridor on a live/mock anchor,
 * exercising every state transition through StatusTracker.
 */

export const MOCK_SEP24_TRANSFER_SERVER = 'https://anchor.sep24.test/sep24';
export const MOCK_SEP24_TRANSACTION_ID = 'sep24-usdc-ngn-txn-721';
export const MOCK_SEP24_JWT = 'sep24-e2e-jwt-usdc-ngn';
export const MOCK_SEP24_NONCE = 'sep24-e2e-nonce-721';

export const sep24InfoResponse = {
  withdraw: {
    USDC: {
      enabled: true,
      fee_fixed: 1,
      fee_percent: 0.5,
      min_amount: 5,
      max_amount: 50000,
    },
  },
  deposit: {},
  fee: { enabled: true },
  transaction: { enabled: true },
  transactions: { enabled: true },
};

export const sep24InteractiveResponse = {
  type: 'interactive_customer_info_needed',
  url: 'https://anchor.sep24.test/interactive?transaction_id=sep24-usdc-ngn-txn-721',
  id: MOCK_SEP24_TRANSACTION_ID,
};

export function makeSep24PollResponse(
  status: string,
  overrides: Record<string, unknown> = {}
): { transaction: Record<string, unknown> } {
  return {
    transaction: {
      id: MOCK_SEP24_TRANSACTION_ID,
      status,
      amount_in: '100',
      amount_in_asset: 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      amount_out: '154840',
      amount_out_asset: 'iso4217:NGN',
      amount_fee: '1.50',
      stellar_transaction_id: 'a1b2c3d4e5f60789a1b2c3d4e5f60789a1b2c3d4e5f60789a1b2c3d4e5f60789',
      started_at: '2026-07-23T18:00:00Z',
      ...overrides,
    },
  };
}

export const pollSep24UserTransferStart = makeSep24PollResponse('pending_user_transfer_start');
export const pollSep24UserTransferComplete = makeSep24PollResponse('pending_user_transfer_complete');
export const pollSep24PendingAnchor = makeSep24PollResponse('pending_anchor');
export const pollSep24PendingExternal = makeSep24PollResponse('pending_external', {
  external_transaction_id: 'ngn-bank-ref-721',
});
export const pollSep24Completed = makeSep24PollResponse('completed', {
  external_transaction_id: 'ngn-bank-ref-721',
  completed_at: '2026-07-23T18:05:00Z',
});
