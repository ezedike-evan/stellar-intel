/**
 * lib/router/hops.ts
 *
 * Solver hop architecture (#815) — composes on-ramp, swap, and yield legs
 * (the modules H2 deferred; see ROADMAP.md) into a single sequenced chain.
 * Connector implementations for each module type are the companion issue (#816).
 *
 * Two-phase composition:
 *   1. planHopChain — simulates every hop in order, threading each hop's
 *      output into the next hop's input. Nothing executes during planning;
 *      if any hop can't plan, the whole chain aborts before anything runs.
 *   2. executeHopChain — executes a chain that has already planned
 *      successfully, in order, stopping at the first failure.
 *
 * "Atomic" here means every hop's preconditions were validated together
 * before any hop ran — not a single rollback-capable ledger transaction.
 * On-ramp/off-ramp legs are off-chain SEP flows and cannot share a Stellar
 * transaction with on-chain swap/yield legs, so there is no ledger
 * primitive that could make the whole chain roll back atomically.
 */

import { getLogger } from '@/lib/logger';
import type {
  Hop,
  HopAsset,
  HopChainExecutionResult,
  HopChainPlan,
  HopContext,
  HopChainPlanResult,
  HopExecutionResult,
  HopStep,
} from '@/types';

const log = getLogger('router/hops');

/**
 * Builds the user-facing message for a hop chain execution failure (#1090):
 * what completed (with a reference if the connector gave one, since real
 * funds may have already moved), what failed and why — the connector's own
 * error code and details, never collapsed to a generic string — and what
 * the user should do next. `completed` must include the failed result as
 * its last entry.
 */
function describeExecutionFailure(
  hopById: Map<string, Hop>,
  completed: HopExecutionResult[]
): string {
  const failed = completed[completed.length - 1];
  if (!failed || failed.ok) {
    // Defensive only: executeHopChain never calls this without a trailing failure.
    return 'The route failed for an unspecified reason.';
  }

  const succeeded = completed.slice(0, -1).filter((r): r is Extract<HopExecutionResult, { ok: true }> => r.ok);

  const completedLines = succeeded.map((r) => {
    const kind = hopById.get(r.hopId)?.type ?? 'step';
    const ref = r.txRef ? ` (reference ${r.txRef})` : '';
    return `The ${kind} step "${r.hopId}" already completed: it produced ${r.output.amount} ${r.output.asset}${ref}.`;
  });

  const failedKind = hopById.get(failed.hopId)?.type;
  const failedLabel = failedKind ? `The ${failedKind} step "${failed.hopId}"` : `Step "${failed.hopId}"`;
  const reason = failed.details ? `${failed.error} (${failed.details})` : failed.error;
  const failedLine = `${failedLabel} failed: ${reason}.`;

  const guidance =
    succeeded.length === 0
      ? 'Nothing in this route executed yet, so it is safe to retry the whole route.'
      : 'The completed step(s) above already moved funds and were not reversed — do not repeat them. Retry only from the failed step, or contact support with the reference(s) above if the funds do not show up.';

  return [...completedLines, failedLine, guidance].join(' ');
}

/**
 * Plans every hop in `hops`, in order, feeding each hop's planned output as
 * the next hop's input. Side-effect free: no hop is executed. Aborts on the
 * first hop that fails to plan, returning the steps that succeeded before it
 * for diagnostics.
 */
export async function planHopChain(
  hops: Hop[],
  initialInput: HopAsset,
  context: HopContext = {}
): Promise<HopChainPlanResult> {
  if (hops.length === 0) {
    return {
      ok: false,
      failedHopId: '',
      error: 'empty_chain',
      details: 'A hop chain requires at least one hop',
      completedSteps: [],
    };
  }

  const steps: HopStep[] = [];
  let currentInput = initialInput;

  for (const hop of hops) {
    const result = await hop.plan(currentInput, context);

    if (!result.ok) {
      log.info(
        { hopId: hop.id, hopType: hop.type, error: result.error, completed: steps.length },
        'hop chain planning aborted'
      );
      return {
        ok: false,
        failedHopId: result.hopId,
        error: result.error,
        ...(result.details !== undefined && { details: result.details }),
        completedSteps: steps,
      };
    }

    steps.push(result.step);
    currentInput = result.step.output;
  }

  log.info(
    { hopCount: steps.length, hopIds: steps.map((s) => s.hopId) },
    'hop chain planned successfully'
  );

  return { ok: true, plan: { type: 'hop_chain', steps, finalOutput: currentInput } };
}

/**
 * Executes every step of an already-planned chain, in order. Stops at the
 * first failure so no downstream hop spends an output that was never
 * actually produced. Requires every hop referenced by the plan to be present
 * in `hops` — a step whose hop is missing is treated as a failure rather
 * than skipped.
 */
export async function executeHopChain(
  plan: HopChainPlan,
  hops: Hop[],
  context: HopContext = {}
): Promise<HopChainExecutionResult> {
  const hopById = new Map(hops.map((hop) => [hop.id, hop]));
  const completed: HopChainExecutionResult['completed'] = [];

  for (const step of plan.steps) {
    const hop = hopById.get(step.hopId);

    if (!hop) {
      completed.push({
        ok: false,
        hopId: step.hopId,
        error: 'hop_not_registered',
        details: `No hop implementation registered for id "${step.hopId}"`,
      });
      return {
        ok: false,
        completed,
        failedAt: step.hopId,
        message: describeExecutionFailure(hopById, completed),
      };
    }

    const result = await hop.execute(step, context);
    completed.push(result);

    if (!result.ok) {
      log.info({ hopId: step.hopId, error: result.error }, 'hop chain execution stopped');
      return {
        ok: false,
        completed,
        failedAt: step.hopId,
        message: describeExecutionFailure(hopById, completed),
      };
    }
  }

  return { ok: true, completed };
}
