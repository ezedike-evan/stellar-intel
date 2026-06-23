import type { AnchorRate, RateComparison, Sep1TomlData } from '@/types';
import { USDC_ASSET } from '@/constants/anchors';
import { getAnchorsByCorridorId, getCorridorById } from './anchors';
import { resolveAnchor } from './sep1';
import { assertSep38Capable, getSep38Price } from './sep38';
import { getSep24Info } from './sep24';
import { getUsdFxRate } from '@/lib/fx/rates';

/**
 * Per-anchor diagnostic. When an anchor fails to quote we keep the reason so the
 * UI (and logs) can explain an empty corridor instead of silently dropping it.
 */
export interface AnchorRateError {
  anchorId: string;
  anchorName: string;
  reason: string;
}

export interface ServerRatesResult extends RateComparison {
  /** Anchors that could not be quoted, with the reason for each. */
  errors: AnchorRateError[];
}

/** Upper bound for a single anchor's TOML + price round-trip. */
const PER_ANCHOR_TIMEOUT_MS = 8_000;

/**
 * SEP-38 contexts to try, in preference order. Anchors advertise different
 * supported contexts (the reference implementation rejects `sep24`), so we fall
 * through to the next one on an "unsupported context" style rejection rather than
 * assuming a single value works everywhere.
 */
const SEP38_CONTEXTS = ['sep6', 'sep31', 'sep24'] as const;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/** Fetches a /price, trying each supported context until one is accepted. */
async function fetchPriceAcrossContexts(
  quoteServer: string,
  sellAsset: string,
  buyAsset: string,
  amount: string,
  label: string
): ReturnType<typeof getSep38Price> {
  let lastError: unknown;
  for (const context of SEP38_CONTEXTS) {
    try {
      return await withTimeout(
        getSep38Price({
          quoteServer,
          sell_asset: sellAsset,
          buy_asset: buyAsset,
          sell_amount: amount,
          context,
        }),
        PER_ANCHOR_TIMEOUT_MS,
        `${label} SEP-38 /price`
      );
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Builds an *indicative* off-ramp estimate for an anchor that does not offer a
 * SEP-38 quote server: live USD→fiat reference rate applied to the net USDC after
 * the anchor's own published SEP-24 withdraw fee. This is an estimate — the firm
 * rate is set by the anchor inside the SEP-24 interactive flow at execution.
 */
async function indicativeRate(
  anchor: { id: string; name: string },
  toml: Sep1TomlData,
  fiatCode: string,
  corridorId: string,
  amount: string,
  sellAmount: number
): Promise<AnchorRate> {
  const transferServer = toml.TRANSFER_SERVER_SEP0024;
  if (!transferServer) {
    throw new Error('anchor advertises no SEP-24 withdraw server');
  }

  const [info, fxRate] = await Promise.all([
    withTimeout(getSep24Info(transferServer), PER_ANCHOR_TIMEOUT_MS, `${anchor.name} SEP-24 /info`),
    getUsdFxRate(fiatCode),
  ]);

  const assetInfo = info.withdraw[USDC_ASSET.code];
  if (!assetInfo || assetInfo.enabled === false) {
    throw new Error(`anchor does not enable ${USDC_ASSET.code} withdrawals`);
  }

  const feeFixed = assetInfo.fee_fixed ?? 0;
  const feePercent = assetInfo.fee_percent ?? 0;
  const netUsdc = Math.max(0, sellAmount - feeFixed) * (1 - feePercent / 100);
  const totalReceived = netUsdc * fxRate; // USDC treated 1:1 with USD
  const effectiveRate = sellAmount > 0 ? totalReceived / sellAmount : 0;

  if (!Number.isFinite(totalReceived) || totalReceived <= 0 || effectiveRate <= 0) {
    throw new Error(`could not derive an estimate for ${fiatCode}`);
  }

  const feeType: AnchorRate['feeType'] =
    feeFixed > 0 && feePercent > 0 ? 'combined' : feePercent > 0 ? 'percent' : 'flat';

  return {
    anchorId: anchor.id,
    anchorName: anchor.name,
    corridorId,
    fee: feeFixed > 0 ? feeFixed : null,
    feeType,
    exchangeRate: effectiveRate,
    totalReceived,
    source: 'sep24-fee', // rendered as "Indicative" by QuotePill
    updatedAt: new Date(),
  };
}

/**
 * Fetches live SEP-38 indicative prices for every anchor on a corridor.
 *
 * Runs server-side (Node) so the browser's same-origin/CORS policy never applies
 * and anchors that omit `Access-Control-Allow-Origin` are still reachable. Each
 * anchor is resolved independently; a failure (no quote server, timeout, HTTP
 * error) is recorded in `errors` rather than dropped, and the surviving rates are
 * returned. Asset identifiers follow SEP-38: `stellar:CODE:ISSUER` for the sold
 * USDC and `iso4217:CCY` for the delivered fiat.
 */
export async function fetchCorridorRates(
  corridorId: string,
  amount: string
): Promise<ServerRatesResult> {
  const corridor = getCorridorById(corridorId); // throws on unknown corridor
  const anchors = getAnchorsByCorridorId(corridorId);

  const sellAsset = `stellar:${USDC_ASSET.code}:${USDC_ASSET.issuer}`;
  const buyAsset = `iso4217:${corridor.to}`;
  const sellAmount = Number(amount);

  const rates: AnchorRate[] = [];
  const errors: AnchorRateError[] = [];

  await Promise.all(
    anchors.map(async (anchor) => {
      let toml: Sep1TomlData;
      try {
        toml = await withTimeout(
          resolveAnchor(anchor.homeDomain),
          PER_ANCHOR_TIMEOUT_MS,
          `${anchor.name} stellar.toml`
        );
      } catch (err) {
        errors.push({
          anchorId: anchor.id,
          anchorName: anchor.name,
          reason: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      const reasons: string[] = [];

      // Tier 1 — firm SEP-38 quote: the anchor's own live price. Preferred when
      // the anchor advertises a quote server.
      try {
        const quoteServer = assertSep38Capable(toml); // throws when no SEP-38
        const price = await fetchPriceAcrossContexts(
          quoteServer,
          sellAsset,
          buyAsset,
          amount,
          anchor.name
        );

        // buy_amount is the fiat the user nets after fees; treat it as the source
        // of truth and derive the effective rate from it to avoid SEP-38 price
        // direction ambiguity.
        const buyAmount = Number(price.buy_amount);
        const effectiveRate = sellAmount > 0 ? buyAmount / sellAmount : 0;
        if (!Number.isFinite(buyAmount) || buyAmount <= 0 || effectiveRate <= 0) {
          throw new Error(`returned an unusable quote for ${corridor.to}`);
        }

        // Only surface a fee figure when charged in the sold asset (USDC); a
        // fiat-denominated fee is already baked into buy_amount.
        const feeInUsdc =
          price.fee && price.fee.asset === sellAsset ? Number(price.fee.total) : null;

        rates.push({
          anchorId: anchor.id,
          anchorName: anchor.name,
          corridorId,
          fee: feeInUsdc !== null && Number.isFinite(feeInUsdc) ? feeInUsdc : null,
          feeType: 'flat',
          exchangeRate: effectiveRate,
          totalReceived: buyAmount,
          source: 'sep38',
          updatedAt: new Date(),
        });
        return;
      } catch (err) {
        reasons.push(`SEP-38: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Tier 2 — indicative estimate: live reference FX × the anchor's own
      // published SEP-24 withdraw fee. Differentiated per anchor by their fees;
      // the firm rate is confirmed by the anchor at execution time.
      try {
        rates.push(await indicativeRate(anchor, toml, corridor.to, corridorId, amount, sellAmount));
        return;
      } catch (err) {
        reasons.push(`Indicative: ${err instanceof Error ? err.message : String(err)}`);
      }

      errors.push({
        anchorId: anchor.id,
        anchorName: anchor.name,
        reason: reasons.join(' | '),
      });
    })
  );

  let bestRateId = '';
  if (rates.length > 0) {
    const best = rates.reduce((a, b) => ((b.totalReceived ?? 0) > (a.totalReceived ?? 0) ? b : a));
    bestRateId = best.anchorId;
  }

  return { corridorId, rates, pending: [], bestRateId, errors };
}
