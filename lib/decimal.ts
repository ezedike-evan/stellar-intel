/**
 * Exact decimal-string arithmetic helpers shared by the router and the
 * client-side min-receive guard. Values are scaled to 7 decimal places (the
 * Stellar amount precision) in BigInt, so large financial amounts never go
 * through a float.
 */
export const DECIMAL_SCALE = 10n ** 7n;

export function parseDecimal(value: string): bigint {
  let str = value.trim();
  let sign = 1n;
  if (str.startsWith('-')) {
    sign = -1n;
    str = str.slice(1);
  } else if (str.startsWith('+')) {
    str = str.slice(1);
  }

  let exp = 0;
  const eIdx = str.search(/[eE]/);
  if (eIdx !== -1) {
    exp = parseInt(str.slice(eIdx + 1), 10) || 0;
    str = str.slice(0, eIdx);
  }

  const [intPart = '0', fracPart = ''] = str.split('.');
  const digits = `${intPart}${fracPart}`.replace(/\D/g, '') || '0';
  const pointFromRight = fracPart.length - exp;
  const shift = 7 - pointFromRight; // scale to 7 decimal places
  const magnitude =
    shift >= 0 ? BigInt(digits) * 10n ** BigInt(shift) : BigInt(digits) / 10n ** BigInt(-shift);
  return sign * magnitude;
}

/**
 * Compares two decimal strings numerically.
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareDecimals(a: string, b: string): number {
  const bigA = parseDecimal(a);
  const bigB = parseDecimal(b);
  if (bigA < bigB) return -1;
  if (bigA > bigB) return 1;
  return 0;
}
