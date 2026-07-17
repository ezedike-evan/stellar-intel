import { createHash } from 'crypto';

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
export type PublishFailureReason = 'non_retryable' | 'retries_exhausted';

export interface PublishAlert {
  reason: PublishFailureReason;
  error: unknown;
  /** intentHash of the outcome row whose write failed, when known. */
  intentHash?: string;
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
}

export const DEFAULT_BATCH_SIZE = 100;

export interface OutcomeRow {
  intentHash: string;
  anchorId: string;
  corridor: string;
  outcome: string;
  settleSeconds: number | null;
  quotedRate: string;
  deliveredRate: string | null;
}

export interface BatchResult {
  submitted: number;
  skipped: number;
  txHash: string | null;
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
       delivered_rate
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
  }));
}

export async function markPublished(
  executor: QueryExecutor,
  intentHashes: string[],
  txHash: string
): Promise<void> {
  if (intentHashes.length === 0) return;
  const placeholders = intentHashes.map((_, i) => `$${i + 2}`).join(', ');
  await executor(
    `UPDATE outcome_log
       SET published_at = NOW(), oracle_tx_hash = $1
     WHERE intent_hash IN (${placeholders})`,
    [txHash, ...intentHashes]
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
  intentHash?: string;
  onAlert?: AlertHook;
  options?: Partial<RetryOptions>;
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

interface OracleSubmitClient {
  submit_outcome(args: {
    publisher: string;
    anchor_id: string;
    corridor: string;
    outcome_hash: string;
    settle_seconds: number;
    success: boolean;
  }): Promise<{ signAndSend(): Promise<{ sendTransactionResponse?: { hash?: string } }> }>;
}

export async function submitToOracle(
  rows: OutcomeRow[],
  config: Pick<
    BatchConfig,
    'oracleContractId' | 'networkPassphrase' | 'publisherSecret' | 'rpcUrl' | 'retry' | 'onAlert'
  >
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
          settle_seconds: row.settleSeconds ?? 0,
          success: row.outcome === 'completed',
        });
        return assembled.signAndSend();
      },
      { intentHash: row.intentHash, onAlert: config.onAlert, options: config.retry }
    );
    txHash = sent.sendTransactionResponse?.hash ?? txHash;
  }

  if (!txHash) {
    throw new Error('submitToOracle: no transaction was submitted');
  }
  return txHash;
}

export async function runBatch(config: BatchConfig): Promise<BatchResult> {
  const rows = await fetchPendingOutcomes(config.executor, config.batchSize);

  if (rows.length === 0) {
    return { submitted: 0, skipped: 0, txHash: null };
  }

  const txHash = await submitToOracle(rows, config);
  await markPublished(
    config.executor,
    rows.map((r) => r.intentHash),
    txHash
  );

  return { submitted: rows.length, skipped: 0, txHash };
}
