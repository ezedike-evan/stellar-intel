import type { Anchor } from '@/types';
import type { OutcomeLogRow } from '@/types/reputation';
import type { ReputationStore } from './store';
import { ANCHORS } from '@/constants/anchors';

export const BOOTSTRAP_SEED_PREFIX = 'bootstrap-seed';

function bootstrapIntentHash(anchorId: string, corridor: string): string {
  return `${BOOTSTRAP_SEED_PREFIX}::${anchorId}::${corridor}`;
}

export function isBootstrapRow(row: Pick<OutcomeLogRow, 'intentHash'>): boolean {
  return row.intentHash.startsWith(`${BOOTSTRAP_SEED_PREFIX}::`);
}

function makeBootstrapRow(anchorId: string, corridor: string, now: Date): OutcomeLogRow {
  return {
    intentHash: bootstrapIntentHash(anchorId, corridor),
    anchorId,
    corridor,
    quotedRate: '1.0',
    deliveredRate: null,
    quotedAmount: '0',
    deliveredAmount: null,
    settleSeconds: null,
    outcome: 'completed',
    createdAt: now.toISOString(),
    stellarTransactionId: null,
    reconciledAt: null,
    disputed: false,
    disputedReason: null,
    publishedAt: null,
    oracleTxHash: null,
    // Server-side seeds carry no sender signature, so they are unattested and
    // never count towards scores or reach the oracle. Dev/test fixtures only.
    attested: false,
    signerAccount: null,
  };
}

export function buildBootstrapSeeds(
  anchors: Anchor[] = ANCHORS,
  now = new Date()
): OutcomeLogRow[] {
  return anchors.flatMap((anchor) =>
    anchor.corridors.map((corridor) => makeBootstrapRow(anchor.id, corridor, now))
  );
}

/**
 * Appends one bootstrap row per anchor×corridor into the store.
 * Idempotent: re-seeding the same anchor leaves the existing bootstrap row in
 * place (appends are insert-only on intentHash).
 *
 * Writes straight to the store, never through the public append route, which
 * requires a sender signature a server-side seed cannot produce.
 *
 * Returns the number of rows written.
 */
export async function seedReputationStore(
  store: ReputationStore,
  anchors: Anchor[] = ANCHORS,
  now = new Date()
): Promise<number> {
  const seeds = buildBootstrapSeeds(anchors, now);
  let written = 0;
  for (const row of seeds) {
    if (await store.append(row)) written++;
  }
  return written;
}
