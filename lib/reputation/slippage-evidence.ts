import { NETWORK_PASSPHRASE } from '@/lib/config';
import { canonicalize, sha256Hex } from '@/lib/intent/hash';
import type { OutcomeLogRow, SlippageEvidence, SlippageOnChainEvidence } from '@/types/reputation';
import type { SlippageEvaluation } from '@/lib/reputation/slippage';

export type { SlippageEvidence, SlippageOnChainEvidence, SlippageEvaluation };

/**
 * Constructs a canonical slippage-evidence object from an outcome row and evaluation.
 *
 * Fields are explicitly populated field-by-field without spreading row or intent
 * objects, guaranteeing sensitive user data (e.g. recipient identifiers) cannot leak in.
 */
export function buildSlippageEvidence(input: {
  row: OutcomeLogRow;
  anchorTransactionId: string | null;
  evaluation: Extract<SlippageEvaluation, { kind: 'breach' }>;
  detectedAt: string;
  networkPassphrase?: string;
}): SlippageEvidence {
  const { row, anchorTransactionId, evaluation, detectedAt } = input;

  if (row.signerAccount === null || row.signerAccount === undefined) {
    throw new Error('row.signerAccount cannot be null');
  }
  if (row.minReceive === null || row.minReceive === undefined) {
    throw new Error('row.minReceive cannot be null');
  }
  if (row.deliveredAmount === null || row.deliveredAmount === undefined) {
    throw new Error('row.deliveredAmount cannot be null');
  }

  const networkPassphrase = input.networkPassphrase ?? NETWORK_PASSPHRASE;

  return {
    v: 1,
    networkPassphrase,
    intentHash: row.intentHash,
    anchorId: row.anchorId,
    corridor: row.corridor,
    signerAccount: row.signerAccount,
    minReceive: row.minReceive,
    anchorReported: {
      anchorTransactionId,
      amountOut: row.deliveredAmount,
      reportedBy: 'sender',
    },
    shortfall: evaluation.shortfall,
    shortfallBps: evaluation.shortfallBps,
    onChain: null,
    detectedAt,
  };
}

/**
 * Returns a new SlippageEvidence object with verified on-chain payment details attached.
 */
export function withOnChainEvidence(
  e: SlippageEvidence,
  onChain: SlippageOnChainEvidence
): SlippageEvidence {
  return {
    v: e.v,
    networkPassphrase: e.networkPassphrase,
    intentHash: e.intentHash,
    anchorId: e.anchorId,
    corridor: e.corridor,
    signerAccount: e.signerAccount,
    minReceive: e.minReceive,
    anchorReported: {
      anchorTransactionId: e.anchorReported.anchorTransactionId,
      amountOut: e.anchorReported.amountOut,
      reportedBy: e.anchorReported.reportedBy,
    },
    shortfall: e.shortfall,
    shortfallBps: e.shortfallBps,
    onChain: {
      txHash: onChain.txHash,
      ledger: onChain.ledger,
      closedAt: onChain.closedAt,
      successful: onChain.successful,
      from: onChain.from,
      to: onChain.to,
      assetCode: onChain.assetCode,
      assetIssuer: onChain.assetIssuer,
      amount: onChain.amount,
      memoType: onChain.memoType,
      memo: onChain.memo,
    },
    detectedAt: e.detectedAt,
  };
}

/**
 * Serializes slippage evidence to canonical JSON with recursively sorted keys and no whitespace.
 */
export function canonicalEvidenceJson(e: SlippageEvidence): string {
  return canonicalize(e);
}

/**
 * Computes lowercase hex SHA-256 of canonical slippage evidence JSON.
 */
export async function hashSlippageEvidence(e: SlippageEvidence): Promise<string> {
  return sha256Hex(canonicalEvidenceJson(e));
}
