/**
 * Fixture data for the SEP-24 interactive deposit flow.
 *
 * The withdraw fixtures in `sep24.ts` are the model. This file covers the
 * opposite direction — NGN in, USDC out — from the interactive handshake
 * through to the deposit URL the user is sent to.
 */

import type { ResolvedAnchor } from '@/types';

export const MOCK_DEPOSIT_TRANSFER_SERVER = 'https://anchor.sep24.test/sep24';
export const MOCK_DEPOSIT_TRANSACTION_ID = 'sep24-ngn-usdc-dep-114';
export const MOCK_DEPOSIT_JWT = 'sep24-deposit-jwt-ngn-usdc';
export const MOCK_DEPOSIT_ACCOUNT = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
export const MOCK_DEPOSIT_ASSET_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

/** Where the app wants the anchor to return the user once KYC completes. */
export const MOCK_DEPOSIT_CALLBACK_URL = 'https://stellar.intel/onramp/callback';

/** An anchor that advertises SEP-24 and a transfer server. */
export const depositAnchor: ResolvedAnchor = {
  id: 'cowrie',
  name: 'Cowrie',
  homeDomain: 'cowrie.exchange',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: MOCK_DEPOSIT_ASSET_ISSUER,
  TRANSFER_SERVER_SEP0024: MOCK_DEPOSIT_TRANSFER_SERVER,
  WEB_AUTH_ENDPOINT: 'https://cowrie.exchange/auth',
  SIGNING_KEY: 'GCOWRIESIGNINGKEY',
  capabilities: { sep10: true, sep24: true, sep38: false, sep12: false },
  domain: 'cowrie.exchange',
  ANCHOR_QUOTE_SERVER: null,
  NETWORK_PASSPHRASE: null,
  ORG_URL: null,
  ORG_SUPPORT_EMAIL: null,
  ORG_SUPPORT_URL: null,
  CURRENCIES: [],
};

/** The same anchor with SEP-24 unavailable — the flow must stop before any request. */
export const depositAnchorWithoutSep24: ResolvedAnchor = {
  ...depositAnchor,
  TRANSFER_SERVER_SEP0024: null,
  capabilities: { ...depositAnchor.capabilities, sep24: false },
};

/** Request the flow is started with. */
export const depositFlowParams = {
  jwt: MOCK_DEPOSIT_JWT,
  assetCode: 'USDC',
  assetIssuer: MOCK_DEPOSIT_ASSET_ISSUER,
  amount: '150000',
  account: MOCK_DEPOSIT_ACCOUNT,
};

/** Anchor URL with no query string of its own. */
export const DEPOSIT_INTERACTIVE_URL = 'https://anchor.sep24.test/interactive';

/** Anchor URL that already carries a query string — appended params must not clobber it. */
export const DEPOSIT_INTERACTIVE_URL_WITH_QUERY = `${DEPOSIT_INTERACTIVE_URL}?token=abc&step=kyc`;

/** Successful POST /transactions/deposit/interactive response. */
export function makeDepositInteractiveResponse(
  url: string = DEPOSIT_INTERACTIVE_URL
): Record<string, unknown> {
  return {
    type: 'interactive_customer_info_needed',
    url,
    id: MOCK_DEPOSIT_TRANSACTION_ID,
  };
}

/** Anchor replies with a shape the interactive flow cannot use. */
export const depositNonInteractiveResponse = {
  type: 'non_interactive_customer_info_needed',
  fields: ['first_name', 'last_name'],
};

/** Anchor error body returned alongside a 4xx. */
export const depositErrorBody = { error: 'This anchor does not serve NGN deposits' };

/** Minimal fetch-like Response stub — enough for the paths the flow exercises. */
export function makeFetchResponse(
  body: unknown,
  init: { ok?: boolean; status?: number } = {}
): { ok: boolean; status: number; json: () => Promise<unknown> } {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? status < 400,
    status,
    json: async () => body,
  };
}
