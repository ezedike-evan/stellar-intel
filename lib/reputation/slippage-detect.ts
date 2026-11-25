import type { OutcomeLogRow, SlippageBreach } from '@/types/reputation';
import { evaluateSlippage } from '@/lib/reputation/slippage';
import { buildSlippageEvidence, hashSlippageEvidence } from '@/lib/reputation/slippage-evidence';
import {
  getSlippageBreachStore,
  type SlippageBreachStore,
} from '@/lib/reputation/slippage-breaches';

export type SlippageDetectionResult =
  | { kind: 'not_applicable' }
  | { kind: 'met' }
  | { kind: 'breach'; breach: SlippageBreach }
  | { kind: 'error'; message: string };

/**
 * Detects slippage breaches when a completed outcome is appended.
 *
 * Runs only on the append path for attested withdrawal outcomes.
 * Evaluates the settled amount against the signed minReceive floor.
 * On breach, constructs canonical evidence, hashes it, records a SlippageBreach,
 * and stores it in the slippage breach store. Never throws: errors are caught
 * and returned as { kind: 'error', message }.
 */
export async function detectSlippageBreach(
  row: OutcomeLogRow,
  anchorTransactionId: string | null,
  deps: { store?: SlippageBreachStore; now?: () => Date } = {}
): Promise<SlippageDetectionResult> {
  try {
    if (row.direction !== 'withdraw' || !row.attested || !row.signerAccount) {
      return { kind: 'not_applicable' };
    }

    const evaluation = evaluateSlippage({
      minReceive: row.minReceive,
      amountOut: row.deliveredAmount,
      outcome: row.outcome,
    });

    if (evaluation.kind === 'not_applicable') {
      return { kind: 'not_applicable' };
    }

    if (evaluation.kind === 'met') {
      return { kind: 'met' };
    }

    // evaluation.kind === 'breach'
    const nowFn = deps.now ?? (() => new Date());
    const detectedAt = nowFn().toISOString();

    const evidence = buildSlippageEvidence({
      row,
      anchorTransactionId,
      evaluation,
      detectedAt,
    });

    const evidenceHash = await hashSlippageEvidence(evidence);

    const breach: SlippageBreach = {
      intentHash: row.intentHash,
      anchorId: row.anchorId,
      corridor: row.corridor,
      signerAccount: row.signerAccount,
      minReceive: row.minReceive!,
      amountOut: row.deliveredAmount!,
      shortfall: evaluation.shortfall,
      shortfallBps: evaluation.shortfallBps,
      stellarTransactionId: row.stellarTransactionId,
      anchorTransactionId,
      status: 'detected',
      rejectionReason: null,
      evidence,
      evidenceHash,
      detectedAt,
      verifiedAt: null,
    };

    const store = deps.store ?? getSlippageBreachStore();
    await store.create(breach);

    return { kind: 'breach', breach };
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
