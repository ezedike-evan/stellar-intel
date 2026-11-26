import { HORIZON_URL } from '@/constants';
import { CORRIDORS } from '@/constants/anchors';
import type { SlippageBreach, SlippageOnChainEvidence } from '@/types/reputation';
import { fetchPaymentsForTransaction, type HorizonPaymentRecord } from './reconcile';
import { getSlippageBreachStore, type SlippageBreachStore } from './slippage-breaches';
import { hashSlippageEvidence, withOnChainEvidence } from './slippage-evidence';

/** The fields of a Horizon transaction record that verification reads. */
export interface HorizonTransactionRecord {
  hash: string;
  successful: boolean;
  ledger: number;
  created_at: string;
  source_account: string;
  memo_type: string;
  memo?: string;
}

/** Why a detected breach could not be tied to a Stellar payment. */
export type SlippageRejectionReason =
  'no_stellar_transaction' | 'transaction_not_found' | 'transaction_failed' | 'payment_not_found';

/**
 * Loads one transaction from Horizon. A response that is not ok throws an `Error`
 * carrying the HTTP `status`, so a caller can tell "there is no such transaction"
 * (404) from "Horizon could not answer just now".
 */
export async function fetchStellarTransaction(hash: string): Promise<HorizonTransactionRecord> {
  const res = await fetch(`${HORIZON_URL}/transactions/${encodeURIComponent(hash)}`);

  if (!res.ok) {
    throw Object.assign(new Error(`Horizon transaction lookup failed: HTTP ${res.status}`), {
      status: res.status,
    });
  }

  return (await res.json()) as HorizonTransactionRecord;
}

export interface VerifyBreachesDeps {
  store?: SlippageBreachStore;
  loadTransaction?: typeof fetchStellarTransaction;
  loadPayments?: typeof fetchPaymentsForTransaction;
  now?: () => Date;
  /** How many detected breaches one run looks at. Default 50. */
  limit?: number;
}

export interface VerifyBreachesSummary {
  /** Detected breaches this run looked at. */
  scanned: number;
  verified: number;
  rejected: number;
  /** Left `detected` because of an error that may pass; the next run tries them again. */
  failed: number;
}

const DEFAULT_LIMIT = 50;

const PAYMENT_TYPES = new Set([
  'payment',
  'path_payment_strict_send',
  'path_payment_strict_receive',
]);

type SignerPayment = HorizonPaymentRecord & { from: string; to: string; amount: string };

const isNotFound = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { status?: unknown }).status === 404;

/**
 * The payment the signer made in the corridor's source asset, if the transaction
 * holds one. A corridor the registry does not know has no source asset to look for,
 * so nothing matches.
 */
function findSignerPayment(
  breach: SlippageBreach,
  payments: readonly HorizonPaymentRecord[]
): SignerPayment | null {
  const corridor = CORRIDORS.find((c) => c.id === breach.corridor);
  if (!corridor) return null;

  for (const payment of payments) {
    if (!payment.type || !PAYMENT_TYPES.has(payment.type)) continue;
    const from = payment.from ?? payment.source_account;
    if (from !== breach.signerAccount) continue;
    const inSourceAsset =
      corridor.fromIssuer === null
        ? payment.asset_type === 'native'
        : payment.asset_code === corridor.from && payment.asset_issuer === corridor.fromIssuer;
    if (!inSourceAsset) continue;
    // Evidence states where the money went and how much. A record without either
    // cannot be turned into evidence.
    if (typeof payment.to !== 'string' || typeof payment.amount !== 'string') continue;
    return { ...payment, from, to: payment.to, amount: payment.amount };
  }
  return null;
}

function onChainEvidence(
  transaction: HorizonTransactionRecord,
  payment: SignerPayment
): SlippageOnChainEvidence {
  const native = payment.asset_type === 'native';
  return {
    txHash: transaction.hash,
    ledger: transaction.ledger,
    closedAt: transaction.created_at,
    successful: transaction.successful,
    from: payment.from,
    to: payment.to,
    assetCode: native ? 'XLM' : (payment.asset_code ?? ''),
    assetIssuer: native ? null : (payment.asset_issuer ?? null),
    amount: payment.amount,
    memoType: transaction.memo_type,
    memo: transaction.memo ?? null,
  };
}

/**
 * Ties each detected breach to the Stellar payment its intent was paid with, or
 * says why it cannot be.
 *
 * A breach is recorded from what the sender reports. Before anything is refunded on
 * it, the payment has to exist on chain: a successful transaction in which the
 * signer paid the corridor's source asset. When it does, the payment is written into
 * `evidence.onChain`, the evidence is hashed again and the breach becomes `verified`.
 * When it does not, the breach becomes `rejected` with the reason, and its evidence
 * and hash stay as they were.
 *
 * Only a 404 from Horizon means the transaction does not exist. Any other error, from
 * Horizon or from the store, may pass: the breach stays `detected`, counts as
 * `failed`, and the next run looks at it again. One breach failing never stops the
 * others.
 */
export async function verifyDetectedBreaches(
  deps: VerifyBreachesDeps = {}
): Promise<VerifyBreachesSummary> {
  const store = deps.store ?? getSlippageBreachStore();
  const loadTransaction = deps.loadTransaction ?? fetchStellarTransaction;
  const loadPayments = deps.loadPayments ?? fetchPaymentsForTransaction;
  const now = deps.now ?? (() => new Date());
  const summary: VerifyBreachesSummary = { scanned: 0, verified: 0, rejected: 0, failed: 0 };

  const detected = await store.list({ status: 'detected', limit: deps.limit ?? DEFAULT_LIMIT });

  for (const breach of detected) {
    summary.scanned += 1;

    const reject = async (rejectionReason: SlippageRejectionReason): Promise<void> => {
      const resolved = await store.resolveVerification(breach.intentHash, {
        status: 'rejected',
        evidence: breach.evidence,
        evidenceHash: breach.evidenceHash,
        rejectionReason,
        verifiedAt: now().toISOString(),
      });
      // Null means another run resolved it in between; it is theirs to count.
      if (resolved) summary.rejected += 1;
    };

    try {
      const txHash = breach.stellarTransactionId;
      if (!txHash) {
        await reject('no_stellar_transaction');
        continue;
      }

      let transaction: HorizonTransactionRecord;
      try {
        transaction = await loadTransaction(txHash);
      } catch (err) {
        if (!isNotFound(err)) throw err;
        await reject('transaction_not_found');
        continue;
      }
      if (!transaction.successful) {
        await reject('transaction_failed');
        continue;
      }

      const payment = findSignerPayment(breach, await loadPayments(txHash));
      if (!payment) {
        await reject('payment_not_found');
        continue;
      }

      const evidence = withOnChainEvidence(breach.evidence, onChainEvidence(transaction, payment));
      const evidenceHash = await hashSlippageEvidence(evidence);
      const resolved = await store.resolveVerification(breach.intentHash, {
        status: 'verified',
        evidence,
        evidenceHash,
        rejectionReason: null,
        verifiedAt: now().toISOString(),
      });
      if (resolved) summary.verified += 1;
    } catch {
      summary.failed += 1;
    }
  }

  return summary;
}
