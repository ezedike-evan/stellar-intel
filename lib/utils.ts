/**
 * Computes the total fiat amount a user receives after fees and exchange rate.
 * Applies flat fee first, then percentage fee, then multiplies by the exchange rate.
 */
export function computeTotalReceived(
  amount: number,
  fee: number,
  feePercent: number,
  exchangeRate: number
): number {
  const afterFlat = Math.max(0, amount - fee);
  const afterPercent = afterFlat * (1 - feePercent / 100);
  return afterPercent * exchangeRate;
}

/**
 * Formats a number as a localised currency string using the browser's Intl API.
 * Falls back to a plain number string if the currency code is unrecognised.
 */
export function formatCurrency(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}

/**
 * Formats an exchange rate as a human-readable string.
 * e.g. formatRate(1580, 'USDC', 'NGN') → '1 USDC = 1,580 NGN'
 */
export function formatRate(rate: number, from: string, to: string): string {
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(rate);
  return `1 ${from} = ${formatted} ${to}`;
}

/**
 * Returns a human-readable relative time string for a given date.
 * e.g. 'just now', '2 minutes ago', '1 hour ago'
 */
export function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} seconds ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/**
 * Truncates a Stellar public key for display.
 * e.g. 'GABCD...WXYZ' (first 4 + last 4 characters)
 */
export function truncatePublicKey(key: string): string {
  if (key.length <= 8) return key;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/**
 * Returns true if the given date is in the past.
 */
export function isExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() < Date.now();
}

/**
 * Returns a promise that resolves after the given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
