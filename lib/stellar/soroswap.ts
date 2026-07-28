/**
 * lib/stellar/soroswap.ts
 *
 * Thin REST client for Soroswap's swap aggregator API
 * (https://api.soroswap.finance) -- per ROADMAP.md line 90 and issue #816's
 * own scope note, this integrates an existing aggregator rather than
 * rebuilding one.
 *
 * Flow: quote -> build -> (caller signs) -> send. This module covers quote
 * and build; signing is deferred to the wallet exactly like the existing
 * withdraw payment flow (lib/stellar/horizon.ts), and submission reuses the
 * same Horizon path once a transaction is signed.
 */

const SOROSWAP_API_BASE = process.env.SOROSWAP_API_BASE_URL ?? 'https://api.soroswap.finance';

export type SoroswapNetwork = 'mainnet' | 'testnet';
export type SoroswapTradeType = 'EXACT_IN' | 'EXACT_OUT';

export class SoroswapApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Soroswap API error: HTTP ${status}`);
    this.name = 'SoroswapApiError';
    this.status = status;
    this.body = body;
  }
}

export class SoroswapConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SoroswapConfigError';
  }
}

export interface SoroswapQuoteParams {
  /** Soroban contract address (C...) of the asset being sold. */
  assetIn: string;
  /** Soroban contract address (C...) of the asset being bought. */
  assetOut: string;
  /** Amount in the asset's base units (its full-precision integer string). */
  amount: string;
  tradeType?: SoroswapTradeType;
  /** Liquidity sources to consider. Defaults to Soroswap's own AMM plus Phoenix and Aqua. */
  protocols?: string[];
  slippageBps?: number;
}

/**
 * Opaque quote object from POST /quote. Only `amountOut`/`amountIn` are
 * documented and read here; the rest of the object is passed back verbatim
 * to POST /quote/build, so it is deliberately typed as a passthrough bag
 * rather than modeled field-by-field.
 */
export interface SoroswapQuote {
  amountIn: string;
  amountOut: string;
  [key: string]: unknown;
}

export interface SoroswapBuildResult {
  xdr: string;
}

function apiKey(): string {
  const key = process.env.SOROSWAP_API_KEY;
  if (!key) {
    throw new SoroswapConfigError(
      'SOROSWAP_API_KEY is not configured; required to call the Soroswap aggregator API'
    );
  }
  return key;
}

async function post<T>(path: string, network: SoroswapNetwork, body: unknown): Promise<T> {
  const url = `${SOROSWAP_API_BASE}${path}?network=${network}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody: unknown = await res.json().catch(() => null);
    throw new SoroswapApiError(res.status, errBody);
  }

  return (await res.json()) as T;
}

/** POSTs to /quote: the best price across Soroswap, Phoenix, Aqua, and SDEX. */
export async function getSoroswapQuote(
  params: SoroswapQuoteParams,
  network: SoroswapNetwork = 'mainnet'
): Promise<SoroswapQuote> {
  return post<SoroswapQuote>('/quote', network, {
    assetIn: params.assetIn,
    assetOut: params.assetOut,
    amount: params.amount,
    tradeType: params.tradeType ?? 'EXACT_IN',
    protocols: params.protocols ?? ['soroswap', 'phoenix', 'aqua'],
    ...(params.slippageBps !== undefined && { slippageBps: params.slippageBps }),
  });
}

/** POSTs to /quote/build: turns a previously fetched quote into an unsigned XDR. */
export async function buildSoroswapTransaction(
  quote: SoroswapQuote,
  from: string,
  to: string = from,
  network: SoroswapNetwork = 'mainnet'
): Promise<SoroswapBuildResult> {
  return post<SoroswapBuildResult>('/quote/build', network, { quote, from, to });
}
