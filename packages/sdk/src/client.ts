import {
  StellarIntelApiError,
  StellarIntelNetworkError,
  StellarIntelResponseError,
  isApiErrorBody,
} from './errors.js';
import type {
  AnchorHealth,
  CorridorVolumeSavings,
  OfframpIntentRequest,
  OfframpIntentResponse,
  RateComparison,
} from './types.js';

export const DEFAULT_BASE_URL = 'https://stellar-intel.vercel.app';

/**
 * The API version this SDK release is built against.
 *
 * Sent on every request. Pinning is the point: `SUPPORTED_API_VERSIONS` on the
 * server currently holds one entry, so an unpinned client silently follows
 * whatever ships. A pinned one gets a 400 it can act on instead of a response
 * shape it did not expect.
 */
export const API_VERSION = '1.3.0';

/**
 * Statuses worth retrying.
 *
 * By status code alone, deliberately — not by whether the body parsed as an
 * error envelope. A 502/503/504 from an intermediary carries no envelope and is
 * just as transient as a 429 that does.
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const MAX_BACKOFF_MS = 8_000;

export interface ClientOptions {
  baseUrl?: string;
  /** Retries after the first attempt. Default 3. */
  maxRetries?: number;
  /** Per-attempt timeout in ms. Default 10_000. */
  timeoutMs?: number;
  /** Injectable for tests and for runtimes with a non-global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Injectable so tests do not actually wait out the backoff. */
  sleep?: (ms: number) => Promise<void>;
}

interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  /** Reused across this call's own retries so a retry cannot double-execute. */
  idempotencyKey?: string | undefined;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Backoff for the next attempt.
 *
 * `Retry-After` wins when present: the server knows when its window resets and
 * guessing shorter just burns another request against the same limit.
 */
function backoffMs(response: Response | null, attempt: number): number {
  const header = response?.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  }
  return Math.min(2 ** attempt * 500, MAX_BACKOFF_MS);
}

function newIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Node 18 without webcrypto exposed globally, and any exotic runtime.
  return `sdk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Stellar Intel API client.
 *
 * Retries and idempotency keys are **on by default**, not opt-in (#806): a
 * caller who forgets to configure them gets the safe behaviour, and a caller
 * who wants the raw behaviour has to ask.
 */
export class StellarIntelClient {
  readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? defaultSleep;

    if (typeof this.fetchImpl !== 'function') {
      throw new Error(
        'No fetch implementation available. Pass one via `new StellarIntelClient({ fetch })`.'
      );
    }
  }

  /**
   * Rates for a corridor, across every registered anchor.
   *
   * Note this is the **unversioned** `/api/rates/:corridor`. It is the only
   * comparison endpoint that exists, and the v1 namespace does not yet mirror
   * it — stated here rather than implied, because everything else this client
   * calls is under `/api/v1`.
   */
  async getRates(corridorId: string): Promise<RateComparison> {
    return this.request<RateComparison>({
      method: 'GET',
      path: `/api/rates/${encodeURIComponent(corridorId)}`,
    });
  }

  /**
   * Submits an off-ramp intent and returns an unsigned transaction.
   *
   * Nothing moves until the caller signs and submits `unsignedTx`. An
   * `Idempotency-Key` is generated per call and reused across that call's own
   * retries, so a retried request replays the original response rather than
   * creating a second intent.
   */
  async submitOfframpIntent(
    intent: Omit<OfframpIntentRequest, 'type'>,
    options: { idempotencyKey?: string } = {}
  ): Promise<OfframpIntentResponse> {
    return this.request<OfframpIntentResponse>({
      method: 'POST',
      path: '/api/v1/intent/offramp',
      body: { type: 'offramp', ...intent } satisfies OfframpIntentRequest,
      idempotencyKey: options.idempotencyKey ?? newIdempotencyKey(),
    });
  }

  /** Health of a single anchor, from the nightly validation ledger. */
  async getAnchorHealth(anchorId: string): Promise<AnchorHealth> {
    return this.request<AnchorHealth>({
      method: 'GET',
      path: `/api/v1/anchors/${encodeURIComponent(anchorId)}/health`,
    });
  }

  /**
   * Cumulative volume routed and fees saved for a corridor, read from the
   * on-chain oracle rather than this app's database. Amounts are microUSDC.
   */
  async getCorridorVolumeSavings(corridorId: string): Promise<CorridorVolumeSavings> {
    return this.request<CorridorVolumeSavings>({
      method: 'GET',
      path: `/api/v1/corridors/${encodeURIComponent(corridorId)}/volume-savings`,
    });
  }

  /** Liveness of the API itself. */
  async getHealth(): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>({ method: 'GET', path: '/api/v1/health' });
  }

  private async request<T>(options: RequestOptions): Promise<T> {
    const url = `${this.baseUrl}${options.path}`;
    const headers: Record<string, string> = { accept: 'application/json' };
    headers['API-Version'] = API_VERSION;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

    let lastNetworkError: unknown = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let response: Response | null = null;

      try {
        response = await this.fetchImpl(url, {
          method: options.method,
          headers,
          ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        // A transport failure is retryable for the same reason a 503 is: the
        // request may not have reached the server at all.
        lastNetworkError = err;
        if (attempt < this.maxRetries) {
          await this.sleep(backoffMs(null, attempt));
          continue;
        }
        throw new StellarIntelNetworkError(err);
      }

      const text = await response.text();

      if (response.ok) {
        return (text ? JSON.parse(text) : {}) as T;
      }

      if (RETRYABLE_STATUS.has(response.status) && attempt < this.maxRetries) {
        await this.sleep(backoffMs(response, attempt));
        continue;
      }

      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // Not JSON — falls through to StellarIntelResponseError with the body.
      }

      if (isApiErrorBody(parsed)) {
        throw new StellarIntelApiError(parsed.error, response.status);
      }
      throw new StellarIntelResponseError(response.status, text);
    }

    // Only reachable if maxRetries is negative; kept so the type is honest.
    throw new StellarIntelNetworkError(lastNetworkError ?? new Error('retries exhausted'));
  }
}
