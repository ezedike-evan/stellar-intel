import type { Anchor, AnchorRate, Corridor, RateComparison, Sep1TomlData } from '@/types';
import { isAnchorAssetEnabled, USDC_ASSET } from '@/constants/anchors';
import { getAnchorsByCorridorId, getCorridorById } from './anchors';
import { resolveAnchor } from './sep1';
import { assertSep38Capable, getSep38Price } from './sep38';
import { getSep24Info } from './sep24';
import { getSep6Info } from './sep6';
import { getUsdFxRate } from '@/lib/fx/rates';
import { SepError, TimeoutError } from './errors';

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

/**
 * SEP-38 contexts to try, in preference order. Anchors advertise different
 * supported contexts (the reference implementation rejects `sep24`), so we fall
 * through to the next one on an "unsupported context" style rejection rather than
 * assuming a single value works everywhere.
 */
const SEP38_CONTEXTS = ['sep6', 'sep31', 'sep24'] as const;

/**
 * Upper bound for the SEP-6 /info round-trip. This tier is outside B043's scope
 * (config-driven timeouts cover toml, sep38, sep24Info only) so it keeps the
 * previous fixed timeout.
 */
const SEP6_INFO_TIMEOUT_MS = 8_000;

// ─── Config-driven timeouts / retries ─────────────────────────────────────────

export interface ServerRatesTierConfig {
  /** Request deadline for this tier, in milliseconds. */
  timeoutMs: number;
  /** Maximum extra attempts after the first failure (network errors only). */
  retryAttempts: number;
}

export interface ServerRatesConfig {
  /** TOML resolution tier (SEP-1). */
  toml: ServerRatesTierConfig;
  /** SEP-38 indicative price tier. */
  sep38: ServerRatesTierConfig;
  /** SEP-24 info tier (indicative rate fallback). */
  sep24Info: ServerRatesTierConfig;
}

function parseTimeoutMs(value: string | undefined, defaultMs: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs;
}

function parseRetryAttempts(value: string | undefined, defaultAttempts: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : defaultAttempts;
}

/**
 * Tunable timeout budget for each idempotent read in the server-side rate path.
 * Defaults preserve the previous 8s per-anchor behavior; override per tier via
 * environment variables (e.g. RATES_TOML_TIMEOUT_MS) without changing code.
 */
export const serverRatesConfig: ServerRatesConfig = {
  toml: {
    timeoutMs: parseTimeoutMs(process.env.RATES_TOML_TIMEOUT_MS, 8_000),
    retryAttempts: parseRetryAttempts(process.env.RATES_TOML_RETRY_ATTEMPTS, 1),
  },
  sep38: {
    timeoutMs: parseTimeoutMs(process.env.RATES_SEP38_TIMEOUT_MS, 8_000),
    retryAttempts: parseRetryAttempts(process.env.RATES_SEP38_RETRY_ATTEMPTS, 1),
  },
  sep24Info: {
    timeoutMs: parseTimeoutMs(process.env.RATES_SEP24_INFO_TIMEOUT_MS, 8_000),
    retryAttempts: parseRetryAttempts(process.env.RATES_SEP24_INFO_RETRY_ATTEMPTS, 1),
  },
};

function isNetworkError(err: unknown): boolean {
  if (err instanceof SepError) {
    // 5xx and explicit request-timeout are transient; 4xx and below are deterministic.
    return err.httpStatus >= 500 || err.httpStatus === 408 || err.httpStatus === 0;
  }
  if (err instanceof TimeoutError) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('timed out') ||
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('fetch failed') ||
      msg.includes('network error') ||
      msg.includes('unreachable')
    );
  }
  return false;
}

/**
 * Runs `fn` with a hard per-attempt deadline and retries only on network errors.
 * Deterministic 4xx failures are never retried; transient 5xx/timeouts/fetch errors
 * get at most `retryAttempts` extra tries.
 */
async function withTimeoutRetry<T>(
  fn: () => Promise<T>,
  ms: number,
  label: string,
  retryAttempts: number = 1
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryAttempts; attempt++) {
    try {
      return await withTimeout(fn(), ms, label);
    } catch (err) {
      lastError = err;
      if (attempt >= retryAttempts || !isNetworkError(err)) {
        throw err;
      }
      // Fall through to retry this idempotent read once.
    }
  }
  throw lastError;
}

/**
 * Reads a field from a possibly-malformed anchor without letting a throwing
 * getter escape. A bad anchor must not be able to break even its own error
 * report, so reads in the degradation path go through here.
 */
function safeAnchorField(read: () => string, fallback: string): string {
  try {
    return read();
  } catch {
    return fallback;
  }
}

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
      return await withTimeoutRetry(
        () =>
          getSep38Price({
            quoteServer,
            sell_asset: sellAsset,
            buy_asset: buyAsset,
            sell_amount: amount,
            context,
          }),
        serverRatesConfig.sep38.timeoutMs,
        `${label} SEP-38 /price`,
        serverRatesConfig.sep38.retryAttempts
      );
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Builds an *indicative* off-ramp estimate for an anchor that does not offer a
 * SEP-38 quote server: live USD→fiat reference rate applied to the net sold asset
 * after the anchor's own published SEP-24 withdraw fee. This is an estimate for
 * USD-pegged assets — the firm rate is set by the anchor inside the SEP-24
 * interactive flow at execution.
 */
async function indicativeRate(
  anchor: Anchor,
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
    withTimeoutRetry(
      () => getSep24Info(transferServer),
      serverRatesConfig.sep24Info.timeoutMs,
      `${anchor.name} SEP-24 /info`,
      serverRatesConfig.sep24Info.retryAttempts
    ),
    getUsdFxRate(fiatCode),
  ]);

  const assetInfo = info.withdraw[anchor.assetCode];
  if (!assetInfo || assetInfo.enabled === false) {
    throw new Error(`anchor does not enable ${anchor.assetCode} withdrawals`);
  }

  const feeFixed = assetInfo.fee_fixed ?? 0;
  const feePercent = assetInfo.fee_percent ?? 0;
  const netSellAmount = Math.max(0, sellAmount - feeFixed) * (1 - feePercent / 100);
  const totalReceived = netSellAmount * fxRate; // USD-pegged assets treated 1:1 with USD
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

function hasSep6(toml: Sep1TomlData): boolean {
  return !!(toml.capabilities.sep6 && toml.TRANSFER_SERVER);
}

/**
 * Builds an *indicative* off-ramp estimate for a SEP-6 anchor: live USD→fiat
 * reference rate applied to the net USDC after the anchor's SEP-6 fees from
 * GET /info. This is a Tier-3 fallback when neither SEP-38 nor SEP-24 are
 * available. The firm rate is set by the anchor at execution time.
 */
async function sep6IndicativeRate(
  anchor: { id: string; name: string },
  toml: Sep1TomlData,
  fiatCode: string,
  corridorId: string,
  amount: string,
  sellAmount: number
): Promise<AnchorRate> {
  const transferServer = toml.TRANSFER_SERVER!;

  const [config, fxRate] = await Promise.all([
    withTimeout(
      getSep6Info(transferServer, USDC_ASSET.code),
      SEP6_INFO_TIMEOUT_MS,
      `${anchor.name} SEP-6 /info`
    ),
    getUsdFxRate(fiatCode),
  ]);

  const feeFixed = config.feeFixed;
  const feePercent = config.feePercent;
  const netUsdc = Math.max(0, sellAmount - feeFixed) * (1 - feePercent / 100);
  const totalReceived = netUsdc * fxRate;
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
    source: 'sep6-fee',
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
 * returned. Asset identifiers follow SEP-38: `stellar:CODE:ISSUER` for each
 * anchor's registered sold asset and `iso4217:CCY` for the delivered fiat.
 */
export async function fetchCorridorRates(
  corridorId: string,
  amount: string
): Promise<ServerRatesResult> {
  const corridor = getCorridorById(corridorId); // throws on unknown corridor
  const anchors = getAnchorsByCorridorId(corridorId);

  const buyAsset = `iso4217:${corridor.to}`;
  const sellAmount = Number(amount);

  const rates: AnchorRate[] = [];
  const errors: AnchorRateError[] = [];

  await Promise.all(
    anchors.map(async (anchor) => {
      // One bad anchor must never break a corridor render. Capture identity up
      // front — defensively, in case a malformed anchor throws on property
      // access — so the catch-all below can always attribute the failure, then
      // wrap the whole pipeline so any error the tiers don't already handle is
      // recorded in errors[] instead of rejecting Promise.all.
      const anchorId = safeAnchorField(() => anchor.id, 'unknown');
      const anchorName = safeAnchorField(() => anchor.name, anchorId);

      try {
        if (!isAnchorAssetEnabled(anchor.assetCode)) {
          throw new Error(`${anchor.assetCode} rates are disabled by feature flag`);
        }

        const sellAsset = `stellar:${anchor.assetCode}:${anchor.assetIssuer}`;
        await quoteAnchorOnCorridor(
          anchor,
          { corridorId, corridor, sellAsset, buyAsset, amount, sellAmount },
          rates,
          errors
        );
      } catch (err) {
        errors.push({
          anchorId,
          anchorName,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    })
  );

  let bestRateId = '';
  if (rates.length > 0) {
    const best = rates.reduce((a, b) => ((b.totalReceived ?? 0) > (a.totalReceived ?? 0) ? b : a));
    bestRateId = best.anchorId;
  }

  return { corridorId, rates, pending: [], bestRateId, errors };
}

/** Static, per-corridor inputs shared by every anchor on that corridor. */
interface CorridorQuoteContext {
  corridorId: string;
  corridor: Corridor;
  sellAsset: string;
  buyAsset: string;
  amount: string;
  sellAmount: number;
}

/**
 * Resolves a single anchor's best available quote for a corridor and pushes the
 * outcome into the shared `rates`/`errors` accumulators. Handled failures (no
 * TOML, no SEP-38, no indicative estimate) are recorded in `errors`; anything
 * unexpected is left to throw so the caller's per-anchor guard can isolate it.
 */
async function quoteAnchorOnCorridor(
  anchor: Anchor,
  ctx: CorridorQuoteContext,
  rates: AnchorRate[],
  errors: AnchorRateError[]
): Promise<void> {
  const { corridorId, corridor, sellAsset, buyAsset, amount, sellAmount } = ctx;

  let toml: Sep1TomlData;
  try {
    toml = await withTimeoutRetry(
      () => resolveAnchor(anchor.homeDomain),
      serverRatesConfig.toml.timeoutMs,
      `${anchor.name} stellar.toml`,
      serverRatesConfig.toml.retryAttempts
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

    // Only surface a fee figure when charged in the sold asset; a
    // fiat-denominated fee is already baked into buy_amount.
    const feeInSellAsset =
      price.fee && price.fee.asset === sellAsset ? Number(price.fee.total) : null;

    rates.push({
      anchorId: anchor.id,
      anchorName: anchor.name,
      corridorId,
      fee: feeInSellAsset !== null && Number.isFinite(feeInSellAsset) ? feeInSellAsset : null,
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

  // Tier 3 — SEP-6 indicative estimate: live reference FX × the anchor's
  // SEP-6 /info fees. Last resort for anchors that advertise SEP-6 but not
  // SEP-38 or SEP-24 (e.g. Cowrie on usdc-ngn).
  if (hasSep6(toml)) {
    try {
      rates.push(
        await sep6IndicativeRate(anchor, toml, corridor.to, corridorId, amount, sellAmount)
      );
      return;
    } catch (err) {
      reasons.push(`SEP-6: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  errors.push({
    anchorId: anchor.id,
    anchorName: anchor.name,
    reason: reasons.join(' | '),
  });
}
