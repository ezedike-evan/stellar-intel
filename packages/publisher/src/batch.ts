import { createHash } from 'crypto';
import { evaluatePublishGate, type GateDecision, type ProbeCoverageSummary } from './gate';
import type { StellarNetwork } from './network';

// Local copy of ProbeLedgerRow to avoid a monorepo path alias that the
// publisher package's standalone tsconfig does not resolve. Mirrors
// `types/reputation.ts` exactly; keep in sync when that type evolves.
export type ProbeKind = 'uptime' | 'quote' | 'issuer-mismatch' | 'toml-integrity';
export type ProbeFailureType =
  | 'dns'
  | 'tls'
  | 'http'
  | 'timeout'
  | 'mismatch'
  | 'integrity'
  | 'unknown';
export interface ProbeLedgerRow {
  domain: string;
  kind: ProbeKind;
  corridor: string | null;
  reachable: boolean;
  latencyMs: number;
  failureType: ProbeFailureType | null;
  error: string | null;
  probedAt: string;
}

export type QueryExecutor = (
  sql: string,
  params?: unknown[]
) => Promise<{ rows: Record<string, unknown>[] }>;

/**
 * Whether a failed contract-write should be retried. Transient infrastructure
 * failures (RPC/Horizon timeouts, 5xx, sequence-number races) are retryable;
 * deterministic failures (malformed batch, contract-logic rejection) are not.
 */
export type FailureClass = 'retryable' | 'non_retryable';

/** Tuning for the bounded exponential-backoff retry around the oracle write. */
export interface RetryOptions {
  /** Maximum number of attempts (the initial try plus retries). */
  maxAttempts: number;
  /** Base delay in ms; the backoff window doubles each attempt. */
  baseDelayMs: number;
  /** Upper bound on any single backoff delay in ms. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 5,
  baseDelayMs: 200,
  maxDelayMs: 5_000,
};

/** Why a publish attempt ultimately failed, for the alert sink. */
export type PublishFailureReason = 'non_retryable' | 'retries_exhausted' | 'publish_gate_blocked';

export interface PublishAlert {
  reason: PublishFailureReason;
  error: unknown;
  /** intentHash of the outcome row whose write failed, when known. */
  intentHash?: string | undefined;
  /** Number of attempts made before giving up. */
  attempts: number;
}

/**
 * Injected sink for terminal publish failures. Left as a seam here so this
 * package stays free of a concrete alerting dependency; the ops alerting work
 * (#D014) wires it to Sentry / a dead-letter path.
 */
export type AlertHook = (alert: PublishAlert) => void | Promise<void>;

export interface BatchConfig {
  batchSize: number;
  executor: QueryExecutor;
  oracleContractId: string;
  networkPassphrase: string;
  publisherSecret: string;
  horizonUrl: string;
  /** Soroban RPC endpoint (distinct from the classic Horizon API in `horizonUrl`). */
  rpcUrl: string;
  /** Overrides for the contract-write retry policy. Defaults to DEFAULT_RETRY_OPTIONS. */
  retry?: Partial<RetryOptions>;
  /** Alert sink invoked on non-retryable failures and exhausted retries (#D014). */
  onAlert?: AlertHook;
  /**
   * Pre-publish probe-coverage gate (#786). Optional: omitting it publishes
   * exactly as before, so existing callers and their fixtures are unaffected.
   *
   * `loadCoverage` is a thunk rather than a value so an empty queue never pays
   * for a coverage query — it is only called once there is something to publish.
   * Returning `null` from it means "could not determine", which the gate treats
   * as a refusal on mainnet.
   */
  gate?: {
    network: StellarNetwork;
    loadCoverage: () => Promise<ProbeCoverageSummary | null>;
    overrideEnabled: boolean;
    contractId?: string | undefined;
    testnetContractId?: string | undefined;
  };
  /**
   * Corridor rates to publish after the outcome loop (#961). Optional: omit it
   * and the batch behaves exactly as before.
   *
   * A thunk, so the derivation is not computed for a tick that publishes
   * nothing — and so it can read the same rows the batch just wrote.
   */
  loadCorridorRates?: () => Promise<readonly CorridorRateInput[]>;
  /**
   * Probe-derived signals to publish alongside outcomes (#D070 / #785).
   * Optional: omitting it publishes exactly as before (outcomes only).
   *
   * `loadProbeSamples` is a thunk so a tick that publishes nothing never pays
   * for a probe query. When omitted, the batch queries `probe_samples` via the
   * same executor over a configurable window. `windowDays` defaults to 7.
   * `domainToAnchorId` maps probe `domain` (e.g. homeDomain/serviceDomain) to
   * the canonical anchor id surfaced in `ProbeSignals`.
   */
  probeSignals?: {
    windowDays?: number;
    domainToAnchorId?: Record<string, string>;
    loadProbeSamples?: () => Promise<readonly ProbeLedgerRow[]>;
  };
}

export const DEFAULT_BATCH_SIZE = 100;

/** Default window for probe-derived aggregation (#D070). */
export const DEFAULT_PROBE_WINDOW_DAYS = 7;

export interface OutcomeRow {
  intentHash: string;
  anchorId: string;
  corridor: string;
  outcome: string;
  settleSeconds: number | null;
  quotedRate: string;
  deliveredRate: string | null;
  quotedAmount: string;
  deliveredAmount: string | null;
  savingsUsdc?: number;
}

export interface ProbeSignals {
  /** Anchor ID these signals correspond to. */
  anchorId: string;
  /** Uptime ratio: fraction of reachable samples [0, 1], null when no samples. */
  uptimeRatio: number | null;
  /** Latency p50 in milliseconds, null when no reachable samples. */
  p50LatencyMs: number | null;
  /** Latency p95 in milliseconds, null when no reachable samples. */
  p95LatencyMs: number | null;
  /** Number of drift flags for this anchor. */
  driftFlagCount: number;
}

/** Versioned payload sent to the oracle contract. */
export interface ProbeSignalsPayload {
  /** Payload shape version — increment when the on-chain schema changes. */
  version: 1;
  /** Per-anchor probe-derived signals. */
  signals: readonly ProbeSignals[];
}

/** Outcome row augmented with probe signals for on-chain publish. */
export interface OutcomeWithProbeSignals {
  row: OutcomeRow;
  signals: ProbeSignals;
}

export interface BatchResult {
  submitted: number;
  skipped: number;
  txHash: string | null;
  /**
   * The gate's verdict, present only when a gate was configured. When
   * `allowed` is false, `skipped` carries the number of rows withheld.
   */
  gate?: GateDecision;
  /** Corridor rates written on-chain this tick (#961). */
  corridorRatesPublished?: number;
  /** Probe-derived signals written on-chain this tick (#D070). */
  probeSignalsPublished?: number;
  /** Whether probe signals were skipped due to empty probe data (#D070). */
  probeSignalsSkipped?: boolean;
  /** Versioned probe payload that was published, when any (#D070). */
  probePayload?: ProbeSignalsPayload | null;
}

// ─── Probe-derived signals (D070 / #785) ─────────────────────────────────────

function percentileNearestRank(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedValues.length) - 1;
  const index = Math.min(Math.max(rank, 0), sortedValues.length - 1);
  return sortedValues[index]!;
}

function isDriftFlag(row: ProbeLedgerRow): boolean {
  // Drift flags are not a dedicated ProbeKind today (drift lives in a
  // separate store). For the ledger rows we do have, treat a flagged drift as:
  // - an explicit `drift` kind (future-proof), or
  // - a failureType of `mismatch`/`integrity`, or
  // - an error message that mentions drift.
  const kind = row.kind as string;
  if (kind === 'drift') return true;
  if (row.failureType === 'mismatch' || row.failureType === 'integrity') return false; // those are distinct dims, not drift per #D006
  if (row.error && row.error.toLowerCase().includes('drift')) return true;
  // Also accept a loosely-typed `flagged` field if a caller passes DriftSample-like rows.
  const flagged = (row as unknown as Record<string, unknown>)['flagged'];
  if (flagged === true) return true;
  return false;
}

function mapProbeRowRecord(r: Record<string, unknown>): ProbeLedgerRow {
  const domain = String(r['domain'] ?? r['Domain'] ?? '');
  const kindRaw = (r['kind'] ?? r['Kind'] ?? 'uptime') as string;
  const kind = kindRaw as ProbeKind;
  const corridorRaw = r['corridor'] ?? r['Corridor'] ?? r['corridor_id'] ?? null;
  const corridor = corridorRaw == null ? null : String(corridorRaw);
  const reachableRaw = r['reachable'] ?? r['Reachable'];
  const reachable =
    reachableRaw === 1 || reachableRaw === true || reachableRaw === 'true' || reachableRaw === 't';
  // latency: postgres `latency_ms`, sqlite `latencyMs`
  const latencyRaw = r['latency_ms'] ?? r['latencyMs'] ?? r['LatencyMs'] ?? 0;
  const latencyMs = Number(latencyRaw);
  const failureTypeRaw = r['failure_type'] ?? r['failureType'] ?? r['FailureType'] ?? null;
  const failureType = (failureTypeRaw as ProbeLedgerRow['failureType']) ?? null;
  const errorRaw = r['error'] ?? r['Error'] ?? null;
  const error = errorRaw == null ? null : String(errorRaw);
  const probedAtRaw = r['probed_at'] ?? r['probedAt'] ?? r['ProbedAt'] ?? new Date().toISOString();
  const probedAt = String(probedAtRaw);
  return { domain, kind, corridor, reachable, latencyMs, failureType, error, probedAt };
}

/**
 * Fetches probe samples from `probe_samples` over a rolling window.
 *
 * Uses the same `QueryExecutor` as `fetchPendingOutcomes` so the publisher CLI
 * and `/api/publisher/tick` share one code path. A missed table (fresh DB
 * before the first probe run) is treated as empty, not a failure — that is the
 * empty-data case in #785 / lumenwatch/stellar-intel#7.
 */
export async function fetchProbeSamples(
  executor: QueryExecutor,
  windowDays: number = DEFAULT_PROBE_WINDOW_DAYS,
  now: Date = new Date()
): Promise<ProbeLedgerRow[]> {
  const cutoff = new Date(now.getTime() - windowDays * 86400000).toISOString();
  let rows: Record<string, unknown>[] = [];
  try {
    const result = await executor(
      `SELECT domain, kind, corridor, reachable, latency_ms, failure_type, error, probed_at
         FROM probe_samples
        WHERE probed_at >= $1
        ORDER BY probed_at ASC`,
      [cutoff]
    );
    rows = result.rows;
  } catch {
    // Fallback for SQLite-named columns or a missing table (fresh DB).
    try {
      const result = await executor(`SELECT * FROM probe_samples ORDER BY probed_at ASC`, []);
      rows = result.rows;
      // Filter in JS when the WHERE above failed or used a different column name.
      rows = rows.filter((r) => {
        const at = String(r['probed_at'] ?? r['probedAt'] ?? r['probedAt'] ?? '');
        return at >= cutoff;
      });
    } catch {
      return [];
    }
  }
  const mapped = rows.map(mapProbeRowRecord);
  // Ensure window still applies when the first query succeeded without filtering (mock).
  return mapped.filter((r) => r.probedAt >= cutoff);
}

/**
 * Aggregates per-anchor probe-derived signals over the supplied rows.
 *
 * Intended to run over the output of `fetchProbeSamples` — i.e. already
 * windowed — but also accepts a `now`/`windowDays` pair to window again
 * defensively. Pure, clock-injectable, and mock-free for tests.
 *
 * - `uptimeRatio`: reachable / total for `kind === 'uptime'` (null when none)
 * - `p50LatencyMs` / `p95LatencyMs`: nearest-rank percentiles over reachable
 *   `kind === 'quote'` samples (null when none)
 * - `driftFlagCount`: flagged drift rows per anchor (see `isDriftFlag`)
 */
export function aggregateProbeSignals(
  rows: readonly ProbeLedgerRow[],
  options: {
    windowDays?: number;
    now?: Date;
    domainToAnchorId?: Record<string, string>;
  } = {}
): ProbeSignalsPayload {
  const { windowDays, now, domainToAnchorId } = options;
  let filtered: readonly ProbeLedgerRow[] = rows;
  if (windowDays !== undefined && now !== undefined) {
    const cutoff = new Date(now.getTime() - windowDays * 86400000).toISOString();
    filtered = rows.filter((r) => r.probedAt >= cutoff);
  } else if (windowDays !== undefined) {
    const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString();
    filtered = rows.filter((r) => r.probedAt >= cutoff);
  }

  const domains = [...new Set(filtered.map((r) => r.domain))].sort();
  const signals: ProbeSignals[] = domains.map((domain) => {
    const anchorId = domainToAnchorId?.[domain] ?? domain;
    const domainRows = filtered.filter((r) => r.domain === domain);

    const uptimeRows = domainRows.filter((r) => r.kind === 'uptime');
    const uptimeRatio =
      uptimeRows.length === 0
        ? null
        : uptimeRows.filter((r) => r.reachable).length / uptimeRows.length;

    const quoteReachable = domainRows.filter((r) => r.kind === 'quote' && r.reachable);
    const latencies = quoteReachable.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p50LatencyMs = percentileNearestRank(latencies, 50);
    const p95LatencyMs = percentileNearestRank(latencies, 95);

    const driftFlagCount = domainRows.filter(isDriftFlag).length;

    return { anchorId, uptimeRatio, p50LatencyMs, p95LatencyMs, driftFlagCount };
  });

  return { version: 1, signals };
}

/**
 * Builds a versioned payload from an already-aggregated signal list.
 * Exists so callers that already hold a `ProbeSignals[]` (e.g. from a
 * ReputationStore thunk) can wrap it without re-aggregating.
 */
export function buildProbeSignalsPayload(signals: readonly ProbeSignals[]): ProbeSignalsPayload {
  return { version: 1, signals: [...signals] };
}

export async function fetchPendingOutcomes(
  executor: QueryExecutor,
  limit: number
): Promise<OutcomeRow[]> {
  const { rows } = await executor(
    `SELECT
       intent_hash,
       anchor_id,
       corridor,
       outcome,
       settle_seconds,
       quoted_rate,
       delivered_rate,
       quoted_amount,
       delivered_amount
     FROM outcome_log
     WHERE published_at IS NULL
       AND reconciled_at IS NOT NULL
     ORDER BY reconciled_at ASC
     LIMIT $1`,
    [limit]
  );

  return rows.map((r) => ({
    intentHash: r['intent_hash'] as string,
    anchorId: r['anchor_id'] as string,
    corridor: r['corridor'] as string,
    outcome: r['outcome'] as string,
    settleSeconds: r['settle_seconds'] != null ? Number(r['settle_seconds'] as string) : null,
    quotedRate: r['quoted_rate'] as string,
    deliveredRate: (r['delivered_rate'] as string | null) ?? null,
    quotedAmount: r['quoted_amount'] as string,
    deliveredAmount: (r['delivered_amount'] as string | null) ?? null,
  }));
}

/**
 * Stamps one row with the hash of the transaction that actually carried it.
 *
 * Deliberately single-row. This used to take an array and write one hash across
 * all of them, which was wrong twice over: N-1 rows ended up pointing at another
 * row's transaction (and `app/anchors/[id]` surfaces that hash to users), and a
 * mid-batch failure left every row unmarked even though some were already
 * on-chain — so the next tick resubmitted them.
 */
export async function markPublished(
  executor: QueryExecutor,
  intentHash: string,
  txHash: string
): Promise<void> {
  await executor(
    `UPDATE outcome_log
       SET published_at = NOW(), oracle_tx_hash = $1
     WHERE intent_hash = $2`,
    [txHash, intentHash]
  );
}

export function buildOutcomeHash(row: OutcomeRow): string {
  const payload = [
    row.intentHash,
    row.anchorId,
    row.corridor,
    row.outcome,
    row.settleSeconds ?? '',
  ].join(':');
  return createHash('sha256').update(payload).digest('hex');
}

// Substrings that mark a failure as transient and worth retrying: transport
// errors, RPC/Horizon 5xx bodies, rate limiting, and Stellar sequence races.
const RETRYABLE_PATTERNS = [
  'etimedout',
  'econnreset',
  'econnrefused',
  'eai_again',
  'epipe',
  'socket hang up',
  'network',
  'fetch failed',
  'timeout',
  'timed out',
  'service unavailable',
  'temporarily unavailable',
  'try again',
  'too many requests',
  'tx_bad_seq',
  'txbadseq',
  'bad_seq',
];

// Substrings that mark a failure as deterministic: retrying cannot help, so we
// fail fast and alert instead.
const NON_RETRYABLE_PATTERNS = [
  'tx_malformed',
  'txmalformed',
  'malformed',
  'bad request',
  'contract',
  'hosterror',
  'invokehostfunction',
  'unreachablecodereached',
];

function readStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const rec = err as Record<string, unknown>;
  const direct = rec['status'] ?? rec['statusCode'];
  if (typeof direct === 'number') return direct;
  const response = rec['response'];
  if (response && typeof response === 'object') {
    const r = response as Record<string, unknown>;
    const nested = r['status'] ?? r['statusCode'];
    if (typeof nested === 'number') return nested;
  }
  return undefined;
}

function errorHaystack(err: unknown): string {
  if (typeof err === 'string') return err.toLowerCase();
  if (!err || typeof err !== 'object') return String(err).toLowerCase();
  const rec = err as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['message', 'code', 'name']) {
    const value = rec[key];
    if (typeof value === 'string') parts.push(value);
  }
  // Stellar/Horizon nests result codes under response.data.extras.result_codes,
  // which are non-enumerable on Error but present on plain error objects.
  try {
    parts.push(JSON.stringify(rec));
  } catch {
    // Circular refs or BigInt values — the message/code above still classify.
  }
  return parts.join(' ').toLowerCase();
}

/**
 * Decide whether a contract-write failure is worth retrying. HTTP status wins
 * when present (5xx/429 retry, other 4xx do not); otherwise we match known
 * transient markers, then known deterministic ones. Unknown failures are
 * treated as non-retryable so we fail fast and alert rather than hammer the
 * oracle with retries we cannot reason about.
 */
export function classifyError(err: unknown): FailureClass {
  const status = readStatus(err);
  if (status !== undefined) {
    if (status === 429 || (status >= 500 && status < 600)) return 'retryable';
    if (status >= 400 && status < 500) return 'non_retryable';
  }
  const haystack = errorHaystack(err);
  if (RETRYABLE_PATTERNS.some((pattern) => haystack.includes(pattern))) return 'retryable';
  if (NON_RETRYABLE_PATTERNS.some((pattern) => haystack.includes(pattern))) return 'non_retryable';
  return 'non_retryable';
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Full jitter: a random delay in [0, min(maxDelay, base * 2^(attempt-1))) to
// spread out concurrent publishers instead of retrying in lockstep.
function backoffDelay(attempt: number, options: RetryOptions): number {
  const ceiling = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(Math.random() * ceiling);
}

export interface RetryContext {
  /** Forwarded to the alert payload so failures can be traced to a row. */
  intentHash?: string | undefined;
  onAlert?: AlertHook | undefined;
  options?: Partial<RetryOptions> | undefined;
}

/**
 * Run `fn`, retrying only transient failures with bounded exponential backoff
 * and jitter. Non-retryable failures throw immediately after alerting; retries
 * that exhaust the attempt budget also alert before rethrowing the last error.
 */
export async function withRetry<T>(fn: () => Promise<T>, ctx: RetryContext = {}): Promise<T> {
  const options: RetryOptions = { ...DEFAULT_RETRY_OPTIONS, ...ctx.options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (classifyError(err) === 'non_retryable') {
        await ctx.onAlert?.({
          reason: 'non_retryable',
          error: err,
          intentHash: ctx.intentHash,
          attempts: attempt,
        });
        throw err;
      }
      if (attempt < options.maxAttempts) {
        await sleep(backoffDelay(attempt, options));
      }
    }
  }

  await ctx.onAlert?.({
    reason: 'retries_exhausted',
    error: lastError,
    intentHash: ctx.intentHash,
    attempts: options.maxAttempts,
  });
  throw lastError;
}

type AssembledTx = Promise<{
  signAndSend(): Promise<{ sendTransactionResponse?: { hash?: string } }>;
}>;

interface OracleSubmitClient {
  submit_outcome(args: {
    publisher: string;
    anchor_id: string;
    corridor: string;
    outcome_hash: string;
    settle_seconds: bigint;
    success: boolean;
  }): AssembledTx;

  /**
   * Block-level corridor rate (#810, wired in #961).
   *
   * The contract entrypoint and `deriveAllCorridorRates` both shipped and were
   * connected by nothing — the only caller of the derivation was its own test,
   * so no rate has ever reached the chain.
   */
  publish_corridor_rate(args: {
    publisher: string;
    corridor: string;
    rate: bigint;
    decimals: number;
  }): AssembledTx;

  add_volume_savings(args: {
    publisher: string;
    corridor: string;
    volume_delta: bigint;
    savings_delta: bigint;
  }): AssembledTx;

  /**
   * Probe-derived signals (D070 / #785).
   *
   * Not every deployment's contract has this entrypoint yet — the publisher
   * treats a missing method as a no-op rather than a failure, so a rollout can
   * ship the off-chain publisher before the on-chain upgrade lands.
   */
  publish_probe_signals?: (args: { publisher: string; payload: string }) => AssembledTx;

  /** Legacy alias some local deploys expose. */
  set_probe_signals?: (args: { publisher: string; payload: string }) => AssembledTx;
}

/**
 * One corridor rate ready to publish.
 *
 * Structural, matching `CorridorRatePublish` from `lib/oracle/corridor-rate.ts`,
 * for the same reason `ProbeCoverageSummary` is: this package is consumed by
 * the app, so importing app types back into it would invert the dependency.
 */
export interface CorridorRateInput {
  corridor: string;
  /** Scaled by 10^`decimals`, fiat units per 1 USDC. */
  rate: bigint;
  decimals: number;
  sampleCount: number;
}

/**
 * Called after each row is confirmed on-chain, before the next is attempted.
 *
 * This is the crash-safety seam: persisting here means a failure at row k leaves
 * rows 0..k-1 durably marked instead of losing the whole batch's bookkeeping.
 */
export type OnRowSubmitted = (intentHash: string, txHash: string) => Promise<void>;

export async function submitToOracle(
  rows: OutcomeRow[],
  config: Pick<
    BatchConfig,
    'oracleContractId' | 'networkPassphrase' | 'publisherSecret' | 'rpcUrl' | 'retry' | 'onAlert'
  >,
  onRowSubmitted?: OnRowSubmitted
): Promise<string> {
  // Dynamic import: @stellar/stellar-sdk ships ESM-only types, and this
  // package builds as CommonJS — a static import would emit a require()
  // call TS refuses to type-check against an ESM-only module.
  const { contract, Keypair } = await import('@stellar/stellar-sdk');

  const publisherKeypair = Keypair.fromSecret(config.publisherSecret);
  const { signTransaction } = contract.basicNodeSigner(publisherKeypair, config.networkPassphrase);

  const client = (await contract.Client.from({
    contractId: config.oracleContractId,
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    publicKey: publisherKeypair.publicKey(),
    signTransaction,
  })) as unknown as OracleSubmitClient;

  let txHash: string | null = null;
  for (const row of rows) {
    // Wrap the full write (assemble + sign + send) so a retry rebuilds the
    // transaction with a fresh account sequence — the fix for tx_bad_seq races.
    const sent = await withRetry(
      async () => {
        const assembled = await client.submit_outcome({
          publisher: publisherKeypair.publicKey(),
          anchor_id: row.anchorId,
          corridor: row.corridor,
          outcome_hash: buildOutcomeHash(row),
          settle_seconds: BigInt(row.settleSeconds ?? 0),
          success: row.outcome === 'completed',
        });
        return assembled.signAndSend();
      },
      { intentHash: row.intentHash, onAlert: config.onAlert, options: config.retry }
    );
    const rowTxHash = sent.sendTransactionResponse?.hash ?? null;
    if (rowTxHash === null) {
      // A send that reports no hash is not a confirmed write; marking it
      // published would strand the row as permanently unpublishable.
      throw new Error(`submitToOracle: no transaction hash returned for ${row.intentHash}`);
    }

    if (row.outcome === 'completed') {
      const volumeDelta = BigInt(Math.round(Number(row.quotedAmount) * 1_000_000));
      const savingsDelta = BigInt(Math.round((row.savingsUsdc ?? 0) * 1_000_000));

      await withRetry(
        async () => {
          const assembled = await client.add_volume_savings({
            publisher: publisherKeypair.publicKey(),
            corridor: row.corridor,
            volume_delta: volumeDelta,
            savings_delta: savingsDelta,
          });
          return assembled.signAndSend();
        },
        { intentHash: row.intentHash, onAlert: config.onAlert, options: config.retry }
      );
    }

    await onRowSubmitted?.(row.intentHash, rowTxHash);
    txHash = rowTxHash;
  }

  if (!txHash) {
    throw new Error('submitToOracle: no transaction was submitted');
  }
  return txHash;
}

/**
 * Publishes block-level corridor rates (#961).
 *
 * A **second phase**, run after the outcome loop rather than interleaved with
 * it: `submitToOracle` marks each row the moment its write confirms, and that
 * crash-safety contract must not be disturbed by another write sharing the
 * loop. A failure here therefore cannot un-mark an outcome that already landed.
 *
 * Returns the number of corridors written. Never throws — a rate is a
 * best-effort refresh of a value that is overwritten on the next tick, and
 * failing the whole batch over one would strand outcomes that did publish.
 */
export async function publishCorridorRates(
  rates: readonly CorridorRateInput[],
  config: Pick<
    BatchConfig,
    'oracleContractId' | 'networkPassphrase' | 'publisherSecret' | 'rpcUrl' | 'retry' | 'onAlert'
  >
): Promise<number> {
  if (rates.length === 0) return 0;

  const { contract, Keypair } = await import('@stellar/stellar-sdk');
  const publisherKeypair = Keypair.fromSecret(config.publisherSecret);
  const { signTransaction } = contract.basicNodeSigner(publisherKeypair, config.networkPassphrase);

  const client = (await contract.Client.from({
    contractId: config.oracleContractId,
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    publicKey: publisherKeypair.publicKey(),
    signTransaction,
  })) as unknown as OracleSubmitClient;

  let published = 0;
  for (const rate of rates) {
    // A corridor with no settled outcomes has no derivable rate. Skipping is
    // right; publishing a zero would read as "the rate is zero".
    if (rate.sampleCount === 0) continue;

    try {
      const assembled = await withRetry(
        async () => {
          const tx = await client.publish_corridor_rate({
            publisher: publisherKeypair.publicKey(),
            corridor: rate.corridor,
            rate: rate.rate,
            decimals: rate.decimals,
          });
          return tx.signAndSend();
        },
        { onAlert: config.onAlert, options: config.retry }
      );
      if (assembled.sendTransactionResponse?.hash) published += 1;
    } catch {
      // withRetry has already alerted. Keep going: one unwritable corridor
      // should not stop the others.
    }
  }

  return published;
}

async function getCorridorMedianRate(
  executor: QueryExecutor,
  corridor: string
): Promise<number | undefined> {
  const { rows } = await executor(
    `SELECT delivered_rate
       FROM outcome_log
      WHERE corridor = $1
        AND delivered_rate IS NOT NULL
      ORDER BY reconciled_at DESC
      LIMIT 100`,
    [corridor]
  );
  if (rows.length === 0) return undefined;
  const rates = rows
    .map((r) => Number(r['delivered_rate'] as string))
    .filter((r) => !isNaN(r) && r > 0)
    .sort((a, b) => a - b);
  if (rates.length === 0) return undefined;
  const mid = Math.floor(rates.length / 2);
  return rates.length % 2 === 0 ? (rates[mid - 1]! + rates[mid]!) / 2 : rates[mid]!;
}

function calculateSavingsUsdc(row: OutcomeRow, medianRate?: number): number {
  if (row.outcome !== 'completed' || !row.deliveredAmount || !row.quotedAmount) {
    return 0;
  }

  const deliveredAmount = Number(row.deliveredAmount);
  const quotedAmount = Number(row.quotedAmount);

  // Try priority 1: Anchor's own indicative rate (quotedRate)
  let baselineRate = Number(row.quotedRate);

  // Try priority 2: Corridor median rate if baselineRate is unavailable
  if (!baselineRate || baselineRate <= 0) {
    baselineRate = medianRate ?? 0;
  }

  if (baselineRate <= 0) {
    return 0; // Cannot determine baseline, savings = 0
  }

  // savings = baseline_cost_usdc - actual_cost_usdc
  const baselineCost = deliveredAmount / baselineRate;
  const savings = baselineCost - quotedAmount;

  return Math.max(0, savings);
}

/**
 * Publishes probe-derived signals (#D070 / #785).
 *
 * A **third phase**, after outcomes and corridor rates: best-effort, never
 * throws. A missing contract method is treated as "not yet deployed" rather
 * than a failure, so the publisher can ship before the on-chain upgrade.
 * The payload is JSON-stringified with `version: 1` so the consumer crate can
 * distinguish shapes.
 *
 * Returns the number of anchor signals written (0 when skipped or unsupported).
 */
export async function publishProbeSignals(
  payload: ProbeSignalsPayload,
  config: Pick<
    BatchConfig,
    'oracleContractId' | 'networkPassphrase' | 'publisherSecret' | 'rpcUrl' | 'retry' | 'onAlert'
  >
): Promise<number> {
  if (payload.signals.length === 0) return 0;

  let client: OracleSubmitClient;
  let publisherPublicKey: string;
  try {
    const { contract, Keypair } = await import('@stellar/stellar-sdk');
    const publisherKeypair = Keypair.fromSecret(config.publisherSecret);
    publisherPublicKey = publisherKeypair.publicKey();
    const { signTransaction } = contract.basicNodeSigner(
      publisherKeypair,
      config.networkPassphrase
    );
    client = (await contract.Client.from({
      contractId: config.oracleContractId,
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
      publicKey: publisherPublicKey,
      signTransaction,
    })) as unknown as OracleSubmitClient;
  } catch {
    // If the SDK cannot be loaded (test mocks without the method), treat as
    // non-fatal — outcomes already landed.
    return 0;
  }

  const publishFn =
    client.publish_probe_signals ??
    client.set_probe_signals ??
    // Mock-friendly fallback: some test doubles expose a generic `publish_probe_signals` under a different key.
    (client as unknown as Record<string, unknown>)['publish_probe_signals'] ??
    (client as unknown as Record<string, unknown>)['set_probe_signals'];

  if (typeof publishFn !== 'function') {
    // Contract does not yet expose the entrypoint — log and skip.
    // eslint-disable-next-line no-console
    console.log(
      '[publisher] probe signals skipped — contract has no publish_probe_signals entrypoint'
    );
    return 0;
  }

  const payloadJson = JSON.stringify(payload);

  try {
    const assembled = await withRetry(
      async () => {
        const tx = await (
          publishFn as (a: { publisher: string; payload: string }) => AssembledTx
        ).call(client, {
          publisher: publisherPublicKey,
          payload: payloadJson,
        });
        return tx.signAndSend();
      },
      { onAlert: config.onAlert, options: config.retry }
    );
    if (assembled.sendTransactionResponse?.hash) return payload.signals.length;
    return 0;
  } catch {
    // withRetry has already alerted. Probe signals are overwritten next tick,
    // so one failure must not fail the batch that already published outcomes.
    return 0;
  }
}

export async function runBatch(config: BatchConfig): Promise<BatchResult> {
  const rows = await fetchPendingOutcomes(config.executor, config.batchSize);

  if (rows.length === 0) {
    return { submitted: 0, skipped: 0, txHash: null };
  }

  // Gate after the fetch, not before: an empty queue is not a publish, so it
  // should not spend a coverage query or produce a gate verdict. Withheld rows
  // keep published_at NULL and are simply picked up by a later tick.
  let gateDecision: GateDecision | undefined;
  if (config.gate) {
    const coverage = await config.gate.loadCoverage();
    const decision = evaluatePublishGate({
      network: config.gate.network,
      coverage,
      overrideEnabled: config.gate.overrideEnabled,
      contractId: config.gate.contractId,
      testnetContractId: config.gate.testnetContractId,
    });

    if (!decision.allowed) {
      await config.onAlert?.({
        reason: 'publish_gate_blocked',
        error: new Error(decision.message),
        attempts: 0,
      });
      return { submitted: 0, skipped: rows.length, txHash: null, gate: decision };
    }

    gateDecision = decision;

    if (decision.reason === 'override') {
      // error, not warn: an override is a human deciding to publish against an
      // unverified probe history, and it should reach whatever watches errors.
      // eslint-disable-next-line no-console
      console.error(
        '[publisher] publish_gate_overridden — PUBLISH_GATE_OVERRIDE=true bypassed the ' +
          `${config.gate.network} probe-coverage gate for ${rows.length} row(s)`
      );
    }
  }

  // Calculate savings for each row in this batch
  const rowsWithSavings: OutcomeRow[] = [];
  for (const row of rows) {
    if (row.outcome === 'completed') {
      const medianRate = await getCorridorMedianRate(config.executor, row.corridor);
      const savingsUsdc = calculateSavingsUsdc(row, medianRate);
      rowsWithSavings.push({ ...row, savingsUsdc });
    } else {
      rowsWithSavings.push(row);
    }
  }

  let submitted = 0;
  const txHash = await submitToOracle(rowsWithSavings, config, async (intentHash, rowTxHash) => {
    await markPublished(config.executor, intentHash, rowTxHash);
    submitted += 1;
  });

  // `submitted` counts rows actually marked, not rows attempted. If this throws
  // partway the count never reaches rows.length, and the rows that did land stay
  // marked — the next tick picks up only the remainder.
  // Second phase, after every outcome is marked. See publishCorridorRates for
  // why it is not interleaved with the loop above.
  let corridorRatesPublished: number | undefined;
  if (config.loadCorridorRates) {
    const rates = await config.loadCorridorRates();
    corridorRatesPublished = await publishCorridorRates(rates, config);
  }

  // Third phase — probe-derived signals (D070 / #785). Best-effort and never
  // throws: a probe publish failure must not un-mark outcomes that already
  // landed, and an empty probe ledger must not block the outcome batch.
  // Only wired when `probeSignals` is present so existing callers retain the
  // exact pre-D070 behavior unless they opt in (the app tick opts in; the CLI
  // and unit tests with no probe config do not).
  let probeSignalsPublished: number | undefined;
  let probeSignalsSkipped: boolean | undefined;
  let probePayload: ProbeSignalsPayload | null | undefined;
  if (config.probeSignals !== undefined) {
    const windowDays = config.probeSignals.windowDays ?? DEFAULT_PROBE_WINDOW_DAYS;
    let probeRows: readonly ProbeLedgerRow[] = [];
    try {
      if (config.probeSignals.loadProbeSamples) {
        probeRows = await config.probeSignals.loadProbeSamples();
      } else {
        probeRows = await fetchProbeSamples(config.executor, windowDays);
      }
    } catch {
      // A store that is down fails closed for the gate but must not fail the
      // batch for probes — probes are supplementary, outcomes are the durable thing.
      probeRows = [];
    }

    if (probeRows.length === 0) {
      // Empty-data case (#785): probes not yet running or window has no samples.
      // Publish execution outcomes only, log that probe signals were skipped.
      // eslint-disable-next-line no-console
      console.log(
        '[publisher] probe signals skipped — no probe_samples in window (probes not yet running)'
      );
      probeSignalsSkipped = true;
      probeSignalsPublished = 0;
      probePayload = null;
    } else {
      const payload = aggregateProbeSignals(probeRows, {
        ...(config.probeSignals.domainToAnchorId !== undefined
          ? { domainToAnchorId: config.probeSignals.domainToAnchorId }
          : {}),
      });
      probePayload = payload;
      if (payload.signals.length === 0) {
        // No domains in window — treat as empty, not a publish.
        // eslint-disable-next-line no-console
        console.log('[publisher] probe signals skipped — aggregated to zero anchors');
        probeSignalsSkipped = true;
        probeSignalsPublished = 0;
      } else {
        probeSignalsPublished = await publishProbeSignals(payload, config);
        probeSignalsSkipped = false;
      }
    }
  }

  return {
    submitted,
    skipped: rows.length - submitted,
    txHash,
    ...(gateDecision ? { gate: gateDecision } : {}),
    ...(corridorRatesPublished !== undefined ? { corridorRatesPublished } : {}),
    ...(probeSignalsPublished !== undefined ? { probeSignalsPublished } : {}),
    ...(probeSignalsSkipped !== undefined ? { probeSignalsSkipped } : {}),
    ...(probePayload !== undefined ? { probePayload } : {}),
  };
}
