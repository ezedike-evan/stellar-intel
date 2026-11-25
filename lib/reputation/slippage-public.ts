import type { SlippageBreach, SlippageBreachStatus } from '@/types/reputation';

// ─── Public Slippage Breach Summary (Issue #2106) ─────────────────────────────

export interface PublicSlippageBreachSummary {
  intentHash: string;
  anchorId: string;
  corridor: string;
  minReceive: string;
  amountOut: string;
  shortfall: string;
  shortfallBps: number;
  status: SlippageBreachStatus;
  rejectionReason: string | null;
  stellarTransactionId: string | null;
  evidenceHash: string;
  detectedAt: string;
  verifiedAt: string | null;
}

/**
 * Field-by-field copy; strictly excludes signerAccount, recipient, and evidence.
 */
export function toPublicBreachSummary(b: SlippageBreach): PublicSlippageBreachSummary {
  return {
    intentHash: b.intentHash,
    anchorId: b.anchorId,
    corridor: b.corridor,
    minReceive: b.minReceive,
    amountOut: b.amountOut,
    shortfall: b.shortfall,
    shortfallBps: b.shortfallBps,
    status: b.status,
    rejectionReason: b.rejectionReason,
    stellarTransactionId: b.stellarTransactionId,
    evidenceHash: b.evidenceHash,
    detectedAt: b.detectedAt,
    verifiedAt: b.verifiedAt,
  };
}
