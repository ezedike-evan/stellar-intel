import type { Sep6Transaction } from './sep6';

const RATE_DECIMALS = 8;

/** Input fields read from a completed SEP-24 or SEP-6 transaction record. */
export interface RealizedRateInput {
  amountIn?: string | undefined;
  amountOut?: string | undefined;
  amountFee?: string | undefined;
}

/** Realized exchange rate breakdown derived from an anchor's `/transaction` record. */
export interface RealizedRateResult {
  /** What the user received per unit sent, fees included (`amountOut / amountIn`), formatted to 8 decimals. */
  allInRate: string;
  /** Exchange rate excluding fees (`amountOut / (amountIn - amountFee)`), or `null` when fee is absent or `>= amountIn`. */
  netRate: string | null;
  /** The fee string reported on the transaction when present and valid, or `null`. */
  fee: string | null;
}

/**
 * Accepts either a normalized {@link Sep6Transaction} (`amountIn` / `amountOut` / `amountFee`)
 * or a raw SEP-6 transaction payload with snake_case keys (`amount_in` / `amount_out` / `amount_fee`).
 */
export type Sep6RateInput =
  | Sep6Transaction
  | {
      amountIn?: string | undefined;
      amountOut?: string | undefined;
      amountFee?: string | undefined;
      amount_in?: string | undefined;
      amount_out?: string | undefined;
      amount_fee?: string | undefined;
    };

function parseAmount(raw: string | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

/**
 * Computes the realized exchange rate of a completed SEP-24 or SEP-6 transaction
 * from the anchor's `/transaction` fields (`amountIn`, `amountOut`, `amountFee`).
 *
 * - `allInRate = amountOut / amountIn` (formatted to 8 decimal places).
 * - `netRate = amountOut / (amountIn - amountFee)` when `amountFee` is present,
 *   non-negative, and strictly smaller than `amountIn`; otherwise `null`.
 * - Returns `null` when `amountIn` or `amountOut` is missing, non-numeric, or `<= 0`.
 */
export function realizedRate(tx: RealizedRateInput): RealizedRateResult | null {
  const amountIn = parseAmount(tx.amountIn);
  const amountOut = parseAmount(tx.amountOut);

  if (amountIn === null || amountIn <= 0 || amountOut === null || amountOut <= 0) {
    return null;
  }

  const allIn = amountOut / amountIn;
  if (!Number.isFinite(allIn) || allIn <= 0) {
    return null;
  }

  const feeAmount = parseAmount(tx.amountFee);
  const hasValidFee = feeAmount !== null && feeAmount >= 0;
  const fee = hasValidFee && tx.amountFee !== undefined ? tx.amountFee.trim() : null;

  let netRate: string | null = null;
  if (hasValidFee && feeAmount < amountIn) {
    const netIn = amountIn - feeAmount;
    const net = netIn > 0 ? amountOut / netIn : NaN;
    if (Number.isFinite(net) && net > 0) {
      netRate = net.toFixed(RATE_DECIMALS);
    }
  }

  return {
    allInRate: allIn.toFixed(RATE_DECIMALS),
    netRate,
    fee,
  };
}

/**
 * The rate shown to the user before they execute, on the same all-in basis as
 * {@link realizedRate}'s `allInRate`.
 *
 * `exchangeRate` is quoted before the anchor's fees come out, but the delivered
 * amount has had them taken, so comparing the two would book every fee as
 * slippage. `totalReceived / amount` is what the table promised end to end, which
 * is what the delivered amount can honestly be measured against. Falls back to
 * `exchangeRate` when there is no total or no usable amount.
 */
export function quotedAllInRate(
  rate: { totalReceived: number | null; exchangeRate: number | null },
  amount: string
): string | null {
  const sent = Number(amount);
  if (rate.totalReceived !== null && Number.isFinite(sent) && sent > 0) {
    const allIn = rate.totalReceived / sent;
    if (Number.isFinite(allIn) && allIn > 0) return allIn.toFixed(RATE_DECIMALS);
  }
  return rate.exchangeRate === null ? null : String(rate.exchangeRate);
}

/**
 * Maps a SEP-6 transaction (either normalized {@link Sep6Transaction} or raw
 * snake_case `/transaction` fields) into {@link realizedRate}.
 */
export function realizedRateFromSep6(tx: Sep6RateInput): RealizedRateResult | null {
  const record = tx as {
    amountIn?: string | undefined;
    amountOut?: string | undefined;
    amountFee?: string | undefined;
    amount_in?: string | undefined;
    amount_out?: string | undefined;
    amount_fee?: string | undefined;
  };

  return realizedRate({
    amountIn: record.amountIn ?? record.amount_in,
    amountOut: record.amountOut ?? record.amount_out,
    amountFee: record.amountFee ?? record.amount_fee,
  });
}
