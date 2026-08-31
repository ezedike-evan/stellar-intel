/**
 * Fixtures for the SEP-6 GET /deposit request/response contract (#1093).
 *
 * `buildSep6DepositRequest` does not exist in lib/stellar/sep6.ts yet — this
 * is the programmatic counterpart to `buildSep6WithdrawRequest`
 * (lib/stellar/sep6.ts), mirroring the SEP-6 spec's withdraw/deposit symmetry:
 * same three response shapes, `account` in place of `dest` as the required
 * destination parameter.
 *
 * The response shapes mirror the schemas actually enforced at the network
 * boundary in lib/stellar/sep6-schemas.ts (Sep6WithdrawInteractiveSchema,
 * Sep6WithdrawNonInteractiveSchema, Sep6WithdrawNeedsInfoSchema) rather than
 * the older `types/index.ts` Sep6Withdraw* types, which disagree with those
 * schemas on the needs-info shape (array vs. object `fields`) — the schema
 * is what a real response is actually validated against, so it is what a
 * deposit implementation should match too.
 */

export const SEP6_DEPOSIT_TRANSFER_SERVER = 'https://cowrie.exchange/sep6';

/** A minimal valid GET /deposit request: only the two required params. */
export const SEP6_DEPOSIT_PARAMS_MINIMAL = {
  asset_code: 'USDC',
  account: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ2345678901234567890123456',
};

/** A fully-populated GET /deposit request, all documented optional params set. */
export const SEP6_DEPOSIT_PARAMS_FULL = {
  ...SEP6_DEPOSIT_PARAMS_MINIMAL,
  amount: '100',
  type: 'bank_account',
  email_address: 'depositor@example.com',
  memo_type: 'text',
  memo: 'ref-001',
  lang: 'en',
};

// ─── GET /deposit → interactive_customer_info_needed ───────────────────────────

export const sep6DepositInteractiveResponse = {
  type: 'interactive_customer_info_needed',
  url: 'https://cowrie.exchange/sep6/deposit/interactive/session-abc',
  id: 'sep6-deposit-txn-001',
};

// ─── GET /deposit → non_interactive ────────────────────────────────────────────

export const sep6DepositNonInteractiveResponse = {
  type: 'non_interactive',
  id: 'sep6-deposit-txn-002',
  eta: 300,
  min_amount: 10,
  max_amount: 10000,
  extra_info: { message: 'Deposit funds to the account below to begin.' },
};

// ─── GET /deposit → customer_info_status (missing-field error) ────────────────
//
// The anchor rejects the request because required customer info is missing —
// the "missing-field errors" the issue calls out. Shape matches
// Sep6WithdrawNeedsInfoSchema exactly: `fields` is a record keyed by field
// name, not an array of names.

export const sep6DepositNeedsInfoResponse = {
  type: 'customer_info_status',
  fields: {
    email_address: { description: 'Email address for deposit status updates' },
    first_name: { description: 'Legal first name' },
    last_name: { description: 'Legal last name' },
  },
};
