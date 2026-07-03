/**
 * MSW-style fixture data for SEP-6 withdraw E2E tests.
 *
 * Each export describes a mock anchor response at a specific lifecycle stage.
 * Use these with Playwright's page.route() to sequence the anchor's behaviour.
 */

export const MOCK_ANCHOR_BASE = 'https://anchor.sep6.test';
export const MOCK_TRANSFER_SERVER = `${MOCK_ANCHOR_BASE}/sep6`;
export const MOCK_TRANSACTION_ID = 'sep6-e2e-txn-001';
export const MOCK_JWT = 'e2e-test-jwt-sep6';
export const MOCK_NONCE = 'e2e-test-nonce-0001';

// ─── /info response ───────────────────────────────────────────────────────────

export const sep6InfoResponse = {
  withdraw: {
    USDC: {
      enabled: true,
      fee_fixed: 2,
      fee_percent: 0,
      min_amount: 10,
      max_amount: 10000,
      fields: {
        transaction: {
          dest: { description: 'Destination bank account number' },
          type: { description: 'Transfer type', choices: ['bank_account'] },
        },
      },
    },
  },
  deposit: {},
  fee: { enabled: true },
  transaction: { enabled: true },
  transactions: { enabled: true },
};

// ─── Auth (SEP-10) ────────────────────────────────────────────────────────────

export const sep10ChallengeResponse = {
  transaction: 'AAAA...', // placeholder challenge envelope
  network_passphrase: 'Public Global Stellar Network ; September 2015',
};

export const sep10AuthResponse = {
  token: MOCK_JWT,
};

// ─── /withdraw → needs_info ───────────────────────────────────────────────────

export const sep6WithdrawNeedsInfoResponse = {
  type: 'non_interactive_customer_info_needed',
  fields: ['dest', 'dest_extra'],
};

// ─── /customer → verified ────────────────────────────────────────────────────

export const sep6CustomerVerifiedResponse = {
  id: 'customer-001',
  status: 'ACCEPTED',
  fields: {},
};

// ─── /withdraw → pending_user_transfer_start (funds required) ────────────────

export const sep6WithdrawPendingFundsResponse = {
  id: MOCK_TRANSACTION_ID,
  status: 'pending_user_transfer_start',
  how: 'Send the funds to the Stellar address below',
  eta: 5,
  extra_info: { message: 'Send within 1 hour' },
};

// ─── /transaction poll sequence ───────────────────────────────────────────────

export function makePollResponse(
  status: string,
  overrides: Record<string, unknown> = {}
): { transaction: Record<string, unknown> } {
  return {
    transaction: {
      id: MOCK_TRANSACTION_ID,
      status,
      amount_in: '100',
      amount_in_asset: 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      amount_out: '154800',
      amount_out_asset: 'iso4217:NGN',
      amount_fee: '2',
      stellar_transaction_id: 'fund-send-stellar-hash-001',
      ...overrides,
    },
  };
}

export const pollPendingStellar = makePollResponse('pending_stellar');
export const pollPendingExternal = makePollResponse('pending_external');
export const pollCompleted = makePollResponse('completed', {
  external_transaction_id: 'ext-bank-ref-001',
});
