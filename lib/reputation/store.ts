import type {
  LatencyPercentiles,
  OutcomeLogRow,
  ProbeKind,
  ProbeLedgerRow,
} from '@/types/reputation';
import { SqliteReputationStore } from './sqlite';
import { PostgresReputationStore, type SqlExecutor } from './postgres';

export const PROBE_RETENTION_DAYS = 90;

// ─── Pluggable reputation store (Issue #128 / #219) ────────────────────────────
//
// One interface, swappable backends: SQLite for local/dev, Postgres for prod.
// The factory picks a backend from the environment so the rest of the app never
// imports a concrete driver.

export interface OutcomeQuery {
  anchorId?: string;
  corridor?: string;
  /** Only rows that are settled but not yet reconciled (delivery still null). */
  pendingReconciliationOnly?: boolean;
}

export interface DeliveredUpdate {
  deliveredAmount: string;
  deliveredRate: string | null;
  reconciledAt: string;
}

export interface DisputedUpdate {
  disputed: boolean;
  disputedReason: string | null;
}

export interface ProbeSampleQuery {
  corridor?: string;
  kind?: ProbeKind;
}

export interface ReputationStore {
  /** Idempotent on intentHash — re-appending the same row replaces it. */
  append(row: OutcomeLogRow): Promise<void>;
  query(filter?: OutcomeQuery): Promise<OutcomeLogRow[]>;
  /** Backfills delivered amount/rate for a row (used by the reconciler). */
  markDelivered(intentHash: string, update: DeliveredUpdate): Promise<void>;
  /** Sets or clears the disputed flag on a row (used by the dispute API, #164/#165). */
  markDisputed(intentHash: string, update: DisputedUpdate): Promise<void>;
  /** Record a probe sample (uptime or quote-latency) into the health ledger (#D002 / #D005). */
  recordProbeSample(row: ProbeLedgerRow): Promise<void>;
  /** Query probe samples, optionally filtered to a domain and/or corridor/kind, oldest first. */
  queryProbeSamples(domain?: string, filter?: ProbeSampleQuery): Promise<ProbeLedgerRow[]>;
  /** Delete probe samples older than cutoff. Returns the number of rows removed. */
  compactProbes(cutoff: Date): Promise<number>;
  close(): Promise<void>;
}

function matchesProbeFilter(row: ProbeLedgerRow, filter: ProbeSampleQuery): boolean {
  if (filter.corridor && row.corridor !== filter.corridor) return false;
  if (filter.kind && row.kind !== filter.kind) return false;
  return true;
}

/**
 * Nearest-rank percentile over a sorted ascending array of numbers.
 * Returns `null` for an empty input.
 */
export function percentile(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedValues.length) - 1;
  const index = Math.min(Math.max(rank, 0), sortedValues.length - 1);
  return sortedValues[index]!;
}

/**
 * Computes p50/p95 latency over the most recent `windowSize` reachable rows
 * (oldest-first input, so the window is the tail of the array). Unreachable
 * rows are excluded — a timeout shouldn't be counted as "fast" or "slow".
 * Returns `null` when there are no reachable rows in the window.
 */
export function computeLatencyPercentiles(
  rows: readonly ProbeLedgerRow[],
  windowSize = 20
): LatencyPercentiles | null {
  const reachable = rows.filter((r) => r.reachable);
  const windowed = reachable.slice(Math.max(0, reachable.length - windowSize));
  if (windowed.length === 0) return null;

  const sorted = windowed.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    p50Ms: percentile(sorted, 50)!,
    p95Ms: percentile(sorted, 95)!,
    sampleCount: windowed.length,
  };
}

function matches(row: OutcomeLogRow, filter: OutcomeQuery): boolean {
  if (filter.anchorId && row.anchorId !== filter.anchorId) return false;
  if (filter.corridor && row.corridor !== filter.corridor) return false;
  if (filter.pendingReconciliationOnly) {
    if (row.deliveredAmount !== null || row.reconciledAt !== null) return false;
    if (!row.stellarTransactionId) return false;
  }
  return true;
}

/** In-memory backend — the default for tests and a fallback when no driver is set. */
export class InMemoryReputationStore implements ReputationStore {
  private readonly rows = new Map<string, OutcomeLogRow>();
  private readonly probeSamples: ProbeLedgerRow[] = [];

  async append(row: OutcomeLogRow): Promise<void> {
    this.rows.set(row.intentHash, { ...row });
  }

  async query(filter: OutcomeQuery = {}): Promise<OutcomeLogRow[]> {
    return [...this.rows.values()]
      .filter((row) => matches(row, filter))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((row) => ({ ...row }));
  }

  async markDelivered(intentHash: string, update: DeliveredUpdate): Promise<void> {
    const row = this.rows.get(intentHash);
    if (!row) return;
    row.deliveredAmount = update.deliveredAmount;
    row.deliveredRate = update.deliveredRate;
    row.reconciledAt = update.reconciledAt;
  }

  async markDisputed(intentHash: string, update: DisputedUpdate): Promise<void> {
    const row = this.rows.get(intentHash);
    if (!row) return;
    row.disputed = update.disputed;
    row.disputedReason = update.disputedReason;
  }

  async recordProbeSample(row: ProbeLedgerRow): Promise<void> {
    this.probeSamples.push({ ...row });
  }

  async queryProbeSamples(domain?: string, filter?: ProbeSampleQuery): Promise<ProbeLedgerRow[]> {
    const rows = this.probeSamples
      .filter((r) => !domain || r.domain === domain)
      .filter((r) => !filter || matchesProbeFilter(r, filter));
    return rows.map((r) => ({ ...r })).sort((a, b) => a.probedAt.localeCompare(b.probedAt));
  }

  async compactProbes(cutoff: Date): Promise<number> {
    const cutoffIso = cutoff.toISOString();
    const before = this.probeSamples.length;
    this.probeSamples.splice(
      0,
      this.probeSamples.length,
      ...this.probeSamples.filter((r) => r.probedAt >= cutoffIso)
    );
    return before - this.probeSamples.length;
  }

  async close(): Promise<void> {
    this.rows.clear();
    this.probeSamples.length = 0;
  }
}

export type StoreBackend = 'memory' | 'sqlite' | 'postgres';

export interface StoreFactoryOptions {
  backend?: StoreBackend;
  /** SQLite file path (defaults to in-process `:memory:`). */
  sqlitePath?: string;
  /** Required for the `postgres` backend: a pg-compatible query executor. */
  executor?: SqlExecutor;
}

function resolveBackend(explicit?: StoreBackend): StoreBackend {
  if (explicit) return explicit;
  const env = process.env.REPUTATION_BACKEND as StoreBackend | undefined;
  if (env) return env;
  if (process.env.DATABASE_URL) return 'postgres';
  return process.env.NODE_ENV === 'production' ? 'postgres' : 'sqlite';
}

/**
 * Builds a store for the configured backend. Concrete drivers are required
 * lazily so the in-memory/SQLite paths never load the Postgres adapter.
 */
export function createReputationStore(options: StoreFactoryOptions = {}): ReputationStore {
  const backend = resolveBackend(options.backend);

  switch (backend) {
    case 'memory':
      return new InMemoryReputationStore();
    case 'sqlite':
      return new SqliteReputationStore(options.sqlitePath);
    case 'postgres':
      if (!options.executor) {
        throw new Error('The postgres backend requires a SqlExecutor (options.executor).');
      }
      return new PostgresReputationStore(options.executor);
    default:
      throw new Error(`Unknown reputation store backend: ${backend as string}`);
  }
}

// ─── Process-wide singleton (shared by the append + reconcile routes) ──────────

let singleton: ReputationStore | null = null;

export function getReputationStore(): ReputationStore {
  if (!singleton) singleton = createReputationStore();
  return singleton;
}

/** Test seam: swap in (or clear) the process store. */
export function _setReputationStore(store: ReputationStore | null): void {
  singleton = store;
}
