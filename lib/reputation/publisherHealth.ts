import { getPublisherHealth, type PublisherHealthSnapshot } from '@/lib/metrics';
import { getSqlExecutor, hasDatabaseUrl, ReputationStoreUnavailableError } from './pool';

// ─── Durable publisher health (Issue #910) ─────────────────────────────────────
//
// `lib/metrics.ts` keeps publisher health in a module-level object. On
// serverless that is per-instance and resets on every cold start, so it cannot
// answer "when did the publisher last succeed?" — the question alerting (#700)
// actually needs.
//
// Rather than add a `publisher_runs` table, this derives the durable half from
// data the publisher already writes: `outcome_log.published_at` is stamped by
// `markPublished` on every row that reaches the oracle. `MAX(published_at)` is
// therefore the last confirmed publish, and unlike a counter it cannot drift
// from reality — it *is* reality.
//
// (There is a `lib/reputation/migrations/` directory, but nothing applies it;
// schema is created by inline `CREATE TABLE IF NOT EXISTS` in the drivers. A new
// table here would have been dead weight.)

export interface DurablePublisherHealth extends PublisherHealthSnapshot {
  /** Last row confirmed on-chain, from `outcome_log`. Survives cold starts. */
  lastPublishedAt: string | null;
  /** Milliseconds since `lastPublishedAt`, or null when nothing has published. */
  publishedStaleMs: number | null;
  /** Rows waiting to be published — reconciled but not yet on-chain. */
  pendingCount: number | null;
  /**
   * False when no durable backend is configured, in which case only the
   * in-process fields are meaningful. Lets a caller tell "healthy" apart from
   * "cannot tell", which the previous endpoint could not express.
   */
  durable: boolean;
}

interface DurableRow {
  last_published_at: string | null;
  pending_count: string | number | null;
}

/**
 * Publisher health with the durable fields filled in where possible.
 *
 * Never throws: an unreachable database degrades to `durable: false` rather
 * than failing the health endpoint, because a health check that 500s during an
 * incident is worse than one that reports partial information.
 */
export async function getDurablePublisherHealth(now = Date.now()): Promise<DurablePublisherHealth> {
  const inProcess = getPublisherHealth(now);

  if (!hasDatabaseUrl()) {
    return {
      ...inProcess,
      lastPublishedAt: null,
      publishedStaleMs: null,
      pendingCount: null,
      durable: false,
    };
  }

  try {
    const { rows } = await getSqlExecutor().query(
      `SELECT MAX(published_at) AS last_published_at,
              COUNT(*) FILTER (WHERE published_at IS NULL AND reconciled_at IS NOT NULL)
                AS pending_count
         FROM outcome_log`
    );

    const row = rows[0] as unknown as DurableRow | undefined;
    const lastPublishedAt = row?.last_published_at ? new Date(row.last_published_at) : null;

    return {
      ...inProcess,
      lastPublishedAt: lastPublishedAt ? lastPublishedAt.toISOString() : null,
      publishedStaleMs: lastPublishedAt ? now - lastPublishedAt.getTime() : null,
      pendingCount: row?.pending_count != null ? Number(row.pending_count) : null,
      durable: true,
    };
  } catch (error) {
    if (error instanceof ReputationStoreUnavailableError) {
      return {
        ...inProcess,
        lastPublishedAt: null,
        publishedStaleMs: null,
        pendingCount: null,
        durable: false,
      };
    }
    throw error;
  }
}
