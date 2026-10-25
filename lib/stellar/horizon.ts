import {
  Horizon,
  TransactionBuilder,
  Networks,
  Asset,
  Operation,
  Memo,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { HORIZON_URL } from '@/constants';
import type { SwapRoute, StellarAsset } from '@/types';
import { UserRejectedError } from './errors';

export const horizonServer = new Horizon.Server(HORIZON_URL);

const MAX_FEE_STROOPS = 10_000;

// ─── Account loading ──────────────────────────────────────────────────────────

/**
 * Loads a Stellar account from Horizon, returning the account with its
 * current sequence number. Throws a clear error if the account does not exist.
 */
export async function fetchAccount(publicKey: string): Promise<Horizon.AccountResponse> {
  try {
    return await horizonServer.loadAccount(publicKey);
  } catch (err) {
    const horizonErr = err as { response?: { status?: number } };
    if (horizonErr?.response?.status === 404) {
      throw new Error('Account does not exist on the Stellar network');
    }
    throw err;
  }
}

// ─── Deposit preflight ────────────────────────────────────────────────────────

/** Whether an account can receive a deposit of a given asset right now. */
export interface DepositPreflight {
  accountExists: boolean;
  hasTrustline: boolean;
  /** The trustline's `is_authorized`; null when there is no line or Horizon omits it. */
  trustlineAuthorized: boolean | null;
  /** The asset balance as a decimal string; null when there is no line. */
  balance: string | null;
}

/**
 * Checks that `publicKey` can receive `asset`: the account must exist (be funded)
 * and hold a trustline for it. The on-ramp runs this before sending the user to
 * the anchor, so nobody completes KYC and pays fiat into a deposit that cannot
 * land.
 *
 * A Horizon 404 means "no such account" and returns the all-false result rather
 * than throwing; any other error propagates. The native asset needs no trustline,
 * so it always reports `hasTrustline: true` for an existing account.
 */
export async function checkDepositPreflight(
  publicKey: string,
  asset: { code: string; issuer: string }
): Promise<DepositPreflight> {
  let account: Horizon.AccountResponse;
  try {
    account = await horizonServer.loadAccount(publicKey);
  } catch (err) {
    if ((err as { response?: { status?: number } })?.response?.status === 404) {
      return {
        accountExists: false,
        hasTrustline: false,
        trustlineAuthorized: null,
        balance: null,
      };
    }
    throw err;
  }

  const isNative = asset.code === 'XLM' && !asset.issuer;
  const line = account.balances.find((b) =>
    isNative
      ? b.asset_type === 'native'
      : 'asset_code' in b && b.asset_code === asset.code && b.asset_issuer === asset.issuer
  );

  const authorized =
    line && 'is_authorized' in line && typeof line.is_authorized === 'boolean'
      ? line.is_authorized
      : null;

  return {
    accountExists: true,
    hasTrustline: isNative || line !== undefined,
    trustlineAuthorized: authorized,
    balance: line?.balance ?? null,
  };
}

// ─── Payment builder ──────────────────────────────────────────────────────────

export interface BuildWithdrawPaymentParams {
  sourcePublicKey: string;
  anchorAccount: string;
  amount: string;
  memo: string;
  memoType: string;
  assetCode: string;
  assetIssuer: string;
}

/**
 * Builds an unsigned corridor-asset payment transaction destined for the anchor.
 * Applies the memo from the SEP-24 transaction record.
 * Caps the fee at 10,000 stroops.
 */
export async function buildWithdrawPayment(
  params: BuildWithdrawPaymentParams
): Promise<ReturnType<TransactionBuilder['build']>> {
  const { sourcePublicKey, anchorAccount, amount, memo, memoType, assetCode, assetIssuer } = params;

  const account = await fetchAccount(sourcePublicKey);
  const asset = assetIssuer ? new Asset(assetCode, assetIssuer) : Asset.native();

  let recommendedFee = parseInt(BASE_FEE, 10);
  try {
    recommendedFee = await horizonServer.fetchBaseFee();
  } catch {
    // fall back to BASE_FEE
  }
  const fee = Math.min(recommendedFee, MAX_FEE_STROOPS).toString();

  const builder = new TransactionBuilder(account, {
    fee,
    networkPassphrase: Networks.PUBLIC,
  }).setTimeout(180);

  builder.addOperation(
    Operation.payment({
      destination: anchorAccount,
      asset,
      amount,
    })
  );

  // Apply memo from SEP-24 transaction record
  if (memo) {
    if (memoType === 'hash') {
      builder.addMemo(Memo.hash(memo));
    } else if (memoType === 'id') {
      builder.addMemo(Memo.id(memo));
    } else {
      builder.addMemo(Memo.text(memo));
    }
  }

  return builder.build();
}

// ─── Trustline builder ────────────────────────────────────────────────────────

export interface BuildChangeTrustParams {
  sourcePublicKey: string;
  assetCode: string;
  assetIssuer: string;
  /** Decimal string. Omit for the SDK default, which is the maximum. */
  limit?: string;
}

/**
 * Builds an unsigned transaction that adds a trustline for an asset, so a wallet
 * can receive a deposit (see {@link checkDepositPreflight}).
 *
 * Uses the same fee logic and network as {@link buildWithdrawPayment}: the
 * network's base fee capped at 10,000 stroops. Submit it with
 * {@link signAndSubmitPayment}, which signs with Freighter and submits to Horizon
 * whatever the transaction holds. The native asset needs no trustline and throws.
 */
export async function buildChangeTrustTx(
  params: BuildChangeTrustParams
): Promise<ReturnType<TransactionBuilder['build']>> {
  const { sourcePublicKey, assetCode, assetIssuer, limit } = params;

  if (!assetIssuer || assetCode === 'XLM') {
    throw new Error('XLM is the native asset and needs no trustline.');
  }

  const account = await fetchAccount(sourcePublicKey);

  let recommendedFee = parseInt(BASE_FEE, 10);
  try {
    recommendedFee = await horizonServer.fetchBaseFee();
  } catch {
    // fall back to BASE_FEE
  }
  const fee = Math.min(recommendedFee, MAX_FEE_STROOPS).toString();

  return new TransactionBuilder(account, {
    fee,
    networkPassphrase: Networks.PUBLIC,
  })
    .setTimeout(180)
    .addOperation(
      Operation.changeTrust({
        asset: new Asset(assetCode, assetIssuer),
        ...(limit !== undefined ? { limit } : {}),
      })
    )
    .build();
}

// ─── Sign and submit ──────────────────────────────────────────────────────────

/**
 * Signs a transaction with Freighter and submits it to Horizon.
 * Extracts result_codes from Horizon errors for human-readable messages.
 */
export async function signAndSubmitPayment(
  transaction: ReturnType<TransactionBuilder['build']>
): Promise<Horizon.HorizonApi.SubmitTransactionResponse> {
  const { signTransaction } = await import('@stellar/freighter-api');

  const xdr = transaction.toXDR();
  const signResult = await signTransaction(xdr, { networkPassphrase: Networks.PUBLIC });

  if (signResult.error) {
    throw new UserRejectedError();
  }

  const { TransactionBuilder: TB } = await import('@stellar/stellar-sdk');
  const signedTx = TB.fromXDR(signResult.signedTxXdr, Networks.PUBLIC);

  try {
    return await horizonServer.submitTransaction(signedTx);
  } catch (err) {
    const horizonErr = err as {
      response?: { data?: { extras?: { result_codes?: Record<string, string[]> } } };
    };
    const codes = horizonErr?.response?.data?.extras?.result_codes;
    if (codes) {
      const summary = Object.entries(codes)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join(' | ');
      throw new Error(`Transaction failed: ${summary}`);
    }
    throw err;
  }
}

// ─── SDEX path finding (existing) ────────────────────────────────────────────

export interface HorizonSwapRoute {
  routeId: string;
  source: 'SDEX' | 'Soroswap' | 'Phoenix' | 'Aquarius';
  fromAsset: StellarAsset;
  toAsset: StellarAsset;
  fromAmount: number;
  toAmount: number;
  price: number;
  priceImpact: number;
  fee: number;
  path: StellarAsset[];
  estimatedTime: string;
  lastUpdated: Date;
}

export interface OrderBookData {
  bids: Array<{ price: number; amount: number }>;
  asks: Array<{ price: number; amount: number }>;
}

export async function getOrderBook(
  sellingAssetCode: string,
  sellingIssuer: string | undefined,
  buyingAssetCode: string,
  buyingIssuer: string | undefined
): Promise<OrderBookData> {
  const selling =
    sellingAssetCode === 'XLM'
      ? horizonServer.orderbook(
          { code: 'XLM' } as Parameters<typeof horizonServer.orderbook>[0],
          { code: buyingAssetCode, issuer: buyingIssuer ?? '' } as Parameters<
            typeof horizonServer.orderbook
          >[1]
        )
      : horizonServer.orderbook(
          { code: sellingAssetCode, issuer: sellingIssuer ?? '' } as Parameters<
            typeof horizonServer.orderbook
          >[0],
          buyingAssetCode === 'XLM'
            ? ({ code: 'XLM' } as Parameters<typeof horizonServer.orderbook>[1])
            : ({ code: buyingAssetCode, issuer: buyingIssuer ?? '' } as Parameters<
                typeof horizonServer.orderbook
              >[1])
        );

  const book = await selling.call();

  return {
    bids: (book.bids as Array<{ price: string; amount: string }>).slice(0, 10).map((b) => ({
      price: parseFloat(b.price),
      amount: parseFloat(b.amount),
    })),
    asks: (book.asks as Array<{ price: string; amount: string }>).slice(0, 10).map((a) => ({
      price: parseFloat(a.price),
      amount: parseFloat(a.amount),
    })),
  };
}

export async function getStrictSendPaths(
  fromAsset: StellarAsset,
  fromAmount: number,
  toAssets: StellarAsset[]
): Promise<SwapRoute[]> {
  const url = new URL(`${HORIZON_URL}/paths/strict-send`);
  url.searchParams.set('source_amount', fromAmount.toString());

  if (fromAsset.issuer) {
    url.searchParams.set('source_asset_type', 'credit_alphanum4');
    url.searchParams.set('source_asset_code', fromAsset.code);
    url.searchParams.set('source_asset_issuer', fromAsset.issuer);
  } else {
    url.searchParams.set('source_asset_type', 'native');
  }

  toAssets.forEach((a) => {
    if (a.issuer) {
      url.searchParams.append('destination_assets', `${a.code}:${a.issuer}`);
    } else {
      url.searchParams.append('destination_assets', 'native');
    }
  });

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Horizon paths error: ${res.status}`);
  const data = (await res.json()) as {
    _embedded: {
      records: Array<{
        source_amount: string;
        destination_amount: string;
        path: Array<{ asset_code?: string; asset_issuer?: string; asset_type: string }>;
        source_asset_code?: string;
        source_asset_issuer?: string;
        destination_asset_code?: string;
        destination_asset_issuer?: string;
      }>;
    };
  };

  const toAsset = toAssets[0];

  if (!toAsset) return [];

  return data._embedded.records.map((r, i) => {
    const toAmt = parseFloat(r.destination_amount);
    const fromAmt = parseFloat(r.source_amount);

    // Parsed asset data
    const intermediates = r.path
      .map((p) => ({
        code: p.asset_code ?? 'XLM',
        issuer: p.asset_issuer ?? '',
        name: p.asset_code ?? 'XLM',
      }))
      .filter(Boolean) as StellarAsset[];

    const resultRoute: SwapRoute = {
      routeId: `sdex-${fromAsset.code}-${toAsset.code}-${i}`,
      source: 'SDEX',
      fromAsset,
      toAsset,
      fromAmount: fromAmt,
      toAmount: toAmt,
      price: toAmt / fromAmt,
      priceImpact: 0.001,
      fee: 0,
      path: [fromAsset, ...intermediates, toAsset],
      estimatedTime: '~5s',
      lastUpdated: new Date(),
    };
    return resultRoute;
  });
}

// ─── On-chain asset verification ──────────────────────────────────────────────

/**
 * Verifies whether an asset exists on-chain for a given asset code and issuer.
 * Queries Horizon's /assets endpoint.
 */
export async function verifyAssetOnChain(assetCode: string, issuer: string): Promise<boolean> {
  const url = new URL(`${HORIZON_URL}/assets`);
  url.searchParams.set('asset_code', assetCode);
  url.searchParams.set('asset_issuer', issuer);

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    if (res.status === 404 || res.status === 400) {
      return false;
    }
    throw new Error(`Horizon /assets returned HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    _embedded?: {
      records?: Array<{ asset_code?: string; asset_issuer?: string }>;
    };
  };
  const records = data._embedded?.records ?? [];
  return records.some((r) => r.asset_code === assetCode && r.asset_issuer === issuer);
}
