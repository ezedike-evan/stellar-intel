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
  return String(n).padStart(2, '0');
}

/** Formats a settlement duration in milliseconds as `42s`, `4m 05s` or `1h 30m`. */
export function formatSettleDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad2(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${pad2(Math.floor((s % 3600) / 60))}m`;
}
