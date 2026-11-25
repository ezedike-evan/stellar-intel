import { fetchPaymentsForTransaction, type HorizonPaymentRecord } from '@/lib/reputation/reconcile';
import { compareDecimals } from '@/lib/decimal';
import type { RefundAckPayment } from '@/lib/refunds/ack';
import type { RefundOnChainCheck } from '@/lib/refunds/store';

// ─── On-chain refund verification (Issue #2118) ─────────────────────────────
//
// A signed acknowledgement proves the user agreed; this checks that each
// stellar refund payment actually landed on the ledger, paid to the user's
// account in the expected asset and amount.

export type RefundPaymentLoader = (stellarTransactionId: string) => Promise<HorizonPaymentRecord[]>;

const PAYMENT_TYPES = new Set([
  'payment',
  'path_payment_strict_send',
  'path_payment_strict_receive',
]);

const TX_HASH_PATTERN = /^[0-9a-fA-F]{64}$/;

const DEFAULT_TIMEOUT_MS = 5000;

class VerifyTimeoutError extends Error {}

function amountsEqual(recordAmount: string | undefined, expected: string): boolean {
  if (recordAmount === undefined) return false;
  try {
    return compareDecimals(recordAmount, expected) === 0;
  } catch {
    return false;
  }
}

function recordMatches(
  record: HorizonPaymentRecord,
  account: string,
  assetCode: string,
  payment: RefundAckPayment
): boolean {
  return (
    PAYMENT_TYPES.has(record.type ?? '') &&
    record.to === account &&
    record.asset_code === assetCode &&
    amountsEqual(record.amount, payment.amount)
  );
}

export async function verifyRefundPayments(params: {
  account: string;
  assetCode: string;
  payments: RefundAckPayment[];
  loader?: RefundPaymentLoader;
  timeoutMs?: number;
}): Promise<RefundOnChainCheck> {
  const { account, assetCode, payments } = params;
  const loader = params.loader ?? fetchPaymentsForTransaction;
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const stellarPayments = payments.filter((p) => p.idType === 'stellar');
  if (stellarPayments.length === 0) return 'unverifiable';

  if (stellarPayments.some((p) => !TX_HASH_PATTERN.test(p.id))) return 'mismatch';

  const check = async (): Promise<RefundOnChainCheck> => {
    const results = await Promise.all(
      stellarPayments.map(async (payment) => {
        const records = await loader(payment.id);
        return records.some((r) => recordMatches(r, account, assetCode, payment));
      })
    );
    return results.every(Boolean) ? 'verified' : 'mismatch';
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new VerifyTimeoutError('timeout')), timeoutMs);
  });

  try {
    return await Promise.race([check(), timeout]);
  } catch {
    return 'unverifiable';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
