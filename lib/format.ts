/**
 * Formats a delivered amount string using Intl.NumberFormat with currency style.
 * Falls back to `${amount} ${currencyCode}` if the value is not a valid number
 * or the currency code is unrecognised by the runtime.
 *
 * @param amount      Raw amount string from the anchor (e.g. "158000.50")
 * @param currencyCode ISO 4217 currency code (e.g. "NGN", "KES", "BRL")
 */
export function formatDeliveredAmount(amount: string, currencyCode: string): string {
  const numeric = parseFloat(amount);
  if (!isFinite(numeric)) return `${amount} ${currencyCode}`;

  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${currencyCode} ${numeric.toFixed(2)}`;
  }
}

/** True for a 64-character hex Stellar transaction hash. */
export function isValidStellarTxId(id: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(id);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Formats a settlement duration in milliseconds into a compact human-readable string.
 *
 * Examples:
 *   - < 60s: "45s"
 *   - < 60m: "12m 04s"
 *   - >= 60m: "2h 15m"
 *   - Invalid or negative: "—"
 */
export function formatSettleDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m < 60) return `${m}m ${pad2(s)}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${pad2(remM)}m`;
}
