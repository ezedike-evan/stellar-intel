import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { getReputationStore } from '@/lib/reputation/store';
import {
  reconcileReputationOutcomes,
  type ReputationOutcomeRow,
} from '@/lib/reputation/reconcile';

export const runtime = 'nodejs';

// ─── GET /api/reputation/reconcile (Issue #130 / #221) ─────────────────────────
//
// Cron-triggered (see vercel.json). Pulls every settled-but-unreconciled outcome
// row from the store, looks up the on-chain payment via Horizon, and backfills
// the actual delivered amount + rate. No request body needed — the work list
// comes from the store, so a bare cron ping does the right thing.

async function runReconciler(): Promise<{ updated: number; scanned: number; results: unknown[] }> {
  const store = getReputationStore();
  const pending = await store.query({ pendingReconciliationOnly: true });

  // Map outcome-log rows into the reconciler's input shape. Leaving `settledAt`
  // unset marks them all due (we already filtered to the pending set), so rows
  // are never abandoned by a freshness window.
  const rows: ReputationOutcomeRow[] = pending.map((r) => ({
    id: r.intentHash,
    status: 'completed',
    stellarTransactionId: r.stellarTransactionId,
    quotedAmount: r.quotedAmount,
  }));

  const results = await reconcileReputationOutcomes(rows, async (row, update) => {
    await store.markDelivered(row.id, {
      deliveredAmount: update.deliveredAmount,
      deliveredRate: update.deliveredRate ?? null,
      reconciledAt: update.reconciledAt.toISOString(),
    });
  });

  return {
    updated: results.filter((r) => r.status === 'updated').length,
    scanned: rows.length,
    results,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.reputation.reconcile', async (logger) => {
    const summary = await runReconciler();
    logger.info({ event: 'reconcile_run', scanned: summary.scanned, updated: summary.updated });
    return NextResponse.json(summary);
  });
}

// Manual trigger parity for non-cron callers.
export const POST = GET;
