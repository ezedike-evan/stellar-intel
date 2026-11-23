import { AMOUNT_PATTERN } from '@/lib/patterns';
import type { Sep24RefundPayment, Sep24Refunds } from '@/types';

/** The longest refund payment id kept. A Stellar transaction hash is 64 characters. */
const MAX_PAYMENT_ID_LENGTH = 128;

/**
 * An amount as an anchor sent it, turned into the decimal string the rest of the app
 * reads: a string matching `AMOUNT_PATTERN`, or a finite non-negative number.
 *
 * A number is converted with `String(n)` and held to the same pattern. That one rule
 * is what refuses a negative number, `NaN` and `Infinity`, and also a number that
 * JavaScript prints with an exponent (`1e21`, `1e-7`), which no decimal parser
 * downstream would accept.
 */
function parseAmount(raw: unknown): string | undefined {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const text = String(raw);
  return AMOUNT_PATTERN.test(text) ? text : undefined;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/**
 * One entry of `refunds.payments`, or `undefined` when it is not one we can show:
 * the id must be a non-empty string of bounded length, the id type one of the two
 * SEP-24 defines, and the amount a valid amount. A missing or invalid `fee` is `'0'`.
 */
function parsePayment(raw: unknown): Sep24RefundPayment | undefined {
  if (!isRecord(raw)) return undefined;

  const { id, id_type: idType, amount, fee } = raw;
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_PAYMENT_ID_LENGTH) {
    return undefined;
  }
  if (idType !== 'stellar' && idType !== 'external') return undefined;

  const parsedAmount = parseAmount(amount);
  if (parsedAmount === undefined) return undefined;

  return { id, id_type: idType, amount: parsedAmount, fee: parseAmount(fee) ?? '0' };
}

/**
 * The `refunds` object of a SEP-24 or SEP-6 transaction, validated.
 *
 * An anchor's response is untrusted: this object is rendered in the refund panel
 * and feeds the refund records, so it is rebuilt field by field instead of cast.
 * Nothing the anchor sent that is not named here survives.
 *
 * - `undefined` when `raw` is not a plain object, or `amount_refunded` is missing
 *   or not an amount: without it the object says nothing usable.
 * - `amount_fee` falls back to `'0'`.
 * - `payments` is `[]` when it is not an array. Invalid entries are dropped
 *   silently and the valid ones keep their order.
 */
export function parseRefunds(raw: unknown): Sep24Refunds | undefined {
  if (!isRecord(raw)) return undefined;

  const amountRefunded = parseAmount(raw['amount_refunded']);
  if (amountRefunded === undefined) return undefined;

  const payments: Sep24RefundPayment[] = [];
  if (Array.isArray(raw['payments'])) {
    for (const entry of raw['payments']) {
      const payment = parsePayment(entry);
      if (payment !== undefined) payments.push(payment);
    }
  }

  return {
    amount_refunded: amountRefunded,
    amount_fee: parseAmount(raw['amount_fee']) ?? '0',
    payments,
  };
}
