import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { getReputationStore } from '@/lib/reputation/store';
import { reconcileReputationOutcomes, type ReputationOutcomeRow } from '@/lib/reputation/reconcile';
import {
  verifyDetectedBreaches,
  type VerifyBreachesSummary,
} from '@/lib/reputation/slippage-verify';
import { checkCronAuth } from '@/lib/api/cron-auth';
import { checkDurableStore } from '@/lib/api/store-guard';

export const runtime = 'nodejs';

// ─── GET /api/reputation/reconcile (Issue #130 / #221) ─────────────────────────
//
// Triggered by GitHub Actions (.github/workflows/reputation-cron.yml). Pulls every
// settled-but-unreconciled outcome row from the store, looks up the on-chain
// payment via Horizon, and backfills the actual delivered amount + rate. No request
// body needed — the work list comes from the store, so a bare ping does the right thing.
//
// The same run then verifies detected slippage breaches against their Stellar
// payment (#2105). That pass has its own work list and its own failures: if it
// throws, the reconciliation above has still happened and is still reported.

async function runReconciler(): Promise<{
  updated: number;
  scanned: number;
  sourceMismatch: number;
  results: unknown[];
}> {
  const store = getReputationStore();
  // Horizon reconciliation is defined for off-ramps (user → anchor payment);
  // deposit reconciliation is a separate issue (ONR032 "out of scope").
  const pending = await store.query({ pendingReconciliationOnly: true, direction: 'withdraw' });

  // Map outcome-log rows into the reconciler's input shape. Leaving `settledAt`
  // unset marks them all due (we already filtered to the pending set), so rows
  // are never abandoned by a freshness window.
  const rows: ReputationOutcomeRow[] = pending.map((r) => ({
    id: r.intentHash,
    status: 'completed',
    stellarTransactionId: r.stellarTransactionId,
    quotedAmount: r.quotedAmount,
    signerAccount: r.signerAccount,
  }));

  const results = await reconcileReputationOutcomes(
    rows,
    async (row, update) => {
      await store.markDelivered(row.id, {
        deliveredAmount: update.deliveredAmount,
        deliveredRate: update.deliveredRate ?? null,
        reconciledAt: update.reconciledAt.toISOString(),
      });
    },
    {
      // The Horizon payment's source account did not match the account that
      // signed the intent hash — flag the row instead of scoring it silently.
      onSourceMismatch: async (row) => {
        await store.markDisputed(row.id, {
          disputed: true,
          disputedReason: 'payment source does not match signer',
        });
      },
    }
  );

  return {
    updated: results.filter((r) => r.status === 'updated').length,
    sourceMismatch: results.filter((r) => r.status === 'source_mismatch').length,
    scanned: rows.length,
    results,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = checkCronAuth(request);
  if (unauthorized) return unauthorized;

  return withRequestLogger(request, 'api.reputation.reconcile', async (logger) => {
    // `runReconciler` opens with `getReputationStore()`, so without this the
    // unconfigured-backend case arrives as an opaque INTERNAL_ERROR 500.
    const unavailable = checkDurableStore();
    if (unavailable) {
      logger.warn({ event: 'reconcile_store_unavailable' });
      return unavailable;
    }

    const summary = await runReconciler();

    let slippage: VerifyBreachesSummary | null;
    try {
      slippage = await verifyDetectedBreaches();
    } catch (err) {
      logger.warn({
        event: 'slippage_verify_failed',
        message: err instanceof Error ? err.message : String(err),
      });
      slippage = null;
    }

    logger.info({
      event: 'reconcile_run',
      scanned: summary.scanned,
      updated: summary.updated,
      sourceMismatch: summary.sourceMismatch,
      slippage,
    });
    return NextResponse.json({ ...summary, slippage });
  });
}

// Manual trigger parity for non-cron callers.
export const POST = GET;
