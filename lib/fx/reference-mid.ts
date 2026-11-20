import { USDC_ASSET } from '@/constants/anchors';
import { getFxRate as fetchFxRate, getUsdFxRate as fetchUsdFxRate } from '@/lib/fx/rates';
import { getOrderBook as fetchOrderBook, type OrderBookData } from '@/lib/stellar/horizon';

/**
 * Reference mid price for indicative estimates (Q38017): one documented
 * answer to "what is 1 unit of this asset worth in <fiat>", with its source
 * named so every estimate stays explainable.
 *
 * - USDC is treated as exactly 1 USD and converted with the open.er-api
 *   USD→fiat rate (`source: 'fx'`).
 * - An asset with a fiat peg (a corridor's `fromPeg`, e.g. NGNC→NGN, ARST→ARS)
 *   is priced as `getFxRate(peg, fiat)` (`source: 'fx'`).
 * - Any other asset is priced off the SDEX order book against USDC — the
 *   (best bid + best ask) / 2 mid — then converted with the same USD→fiat
 *   rate (`source: 'sdex+fx'`). An empty side or a spread wider than 5% is
 *   an error, never a silently bad price.
 */

export interface ReferenceMidDeps {
  getFxRate?: typeof fetchFxRate;
  getUsdFxRate?: typeof fetchUsdFxRate;
  getOrderBook?: typeof fetchOrderBook;
}

export interface ReferenceMidPrice {
  /** Fiat units per 1 unit of the asset. */
  price: number;
  source: 'fx' | 'sdex+fx';
  detail: string;
}

/** Maximum tolerated (ask − bid) / mid before the book is deemed unusable. */
export const MAX_SPREAD_RATIO = 0.05;

function bestBidAsk(book: OrderBookData): { bid: number; ask: number } {
  const bid = book.bids[0]?.price;
  const ask = book.asks[0]?.price;
  if (bid === undefined || ask === undefined) {
    throw new Error(
      'reference mid unavailable: the SDEX order book against USDC is empty on ' +
        (bid === undefined && ask === undefined
          ? 'both sides'
          : bid === undefined
            ? 'the bid side'
            : 'the ask side')
    );
  }
  return { bid, ask };
}

export async function referenceMidPrice(
  asset: { code: string; issuer: string | null; peg?: string | null },
  fiatCode: string,
  deps: ReferenceMidDeps = {}
): Promise<ReferenceMidPrice> {
  const getFxRate = deps.getFxRate ?? fetchFxRate;
  const getUsdFxRate = deps.getUsdFxRate ?? fetchUsdFxRate;
  const getOrderBook = deps.getOrderBook ?? fetchOrderBook;

  if (asset.code === USDC_ASSET.code && asset.issuer === USDC_ASSET.issuer) {
    const price = await getUsdFxRate(fiatCode);
    return {
      price,
      source: 'fx',
      detail: `USDC treated as 1 USD × open.er-api USD→${fiatCode}`,
    };
  }

  if (asset.peg) {
    const price = await getFxRate(asset.peg, fiatCode);
    return {
      price,
      source: 'fx',
      detail: `${asset.code} pegged to ${asset.peg} × open.er-api ${asset.peg}→${fiatCode}`,
    };
  }

  const book = await getOrderBook(
    asset.code,
    asset.issuer ?? undefined,
    USDC_ASSET.code,
    USDC_ASSET.issuer
  );
  const { bid, ask } = bestBidAsk(book);
  const mid = (bid + ask) / 2;
  const spread = (ask - bid) / mid;
  if (spread > MAX_SPREAD_RATIO) {
    throw new Error(
      `reference mid unusable: the SDEX ${asset.code}/USDC spread is ${(spread * 100).toFixed(1)}%, ` +
        `wider than the ${MAX_SPREAD_RATIO * 100}% limit`
    );
  }

  const usdToFiat = await getUsdFxRate(fiatCode);
  return {
    price: mid * usdToFiat,
    source: 'sdex+fx',
    detail: `SDEX ${asset.code}/USDC mid ${mid} × open.er-api USD→${fiatCode}`,
  };
}
