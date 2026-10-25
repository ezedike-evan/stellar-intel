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
