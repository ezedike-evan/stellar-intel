import { NetworkError } from './errors';

interface RetryOptions {
  attempts?: number;
  base?: number;
  cap?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Helper to extract Retry-After duration in milliseconds.
 * Supports:
 * - Direct numeric / string retryAfter properties
 * - headers/response.headers check (e.g. headers.get('Retry-After') or headers['retry-after'])
 * - Handles both number-of-seconds and HTTP date string formats.
 */
interface RetryableError {
  retryAfter?: number | string;
  retry_after?: number | string;
  headers?: unknown;
  response?: { headers?: unknown };
}

function getRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as RetryableError;

  // 1. Direct retryAfter / retry_after property
  if (typeof e.retryAfter === 'number') {
    return e.retryAfter;
  }
  if (typeof e.retryAfter === 'string') {
    const ms = parseRetryAfterValue(e.retryAfter);
    if (ms !== null) return ms;
  }
  if (typeof e.retry_after === 'number') {
    return e.retry_after;
  }
  if (typeof e.retry_after === 'string') {
    const ms = parseRetryAfterValue(e.retry_after);
    if (ms !== null) return ms;
  }

  // 2. Error headers
  if (e.headers) {
    const ms = getRetryAfterFromHeaders(e.headers);
    if (ms !== null) return ms;
  }

  // 3. Error response headers
  if (e.response && typeof e.response === 'object') {
    if (e.response.headers) {
      const ms = getRetryAfterFromHeaders(e.response.headers);
      if (ms !== null) return ms;
    }
  }

  return null;
}

function getRetryAfterFromHeaders(headers: unknown): number | null {
  if (!headers || typeof headers !== 'object') return null;
  let value: string | null = null;
  const h = headers as { get?: (key: string) => string | null; [key: string]: unknown };

  if (typeof h.get === 'function') {
    value = h.get('Retry-After') || h.get('retry-after');
  } else {
    value = (h['Retry-After'] as string) || (h['retry-after'] as string) || null;
  }

  if (value) {
    return parseRetryAfterValue(value);
  }
  return null;
}

function parseRetryAfterValue(value: string): number | null {
  // Positive integer (seconds)
  if (/^\d+$/.test(value)) {
    return parseInt(value, 10) * 1000;
  }
  // Date string
  const dateMs = Date.parse(value);
  if (!isNaN(dateMs)) {
    const delay = dateMs - Date.now();
    return delay > 0 ? delay : 0;
  }
  return null;
}

/**
 * Runs the promise-returning function `fn` with exponential backoff retries.
 * Only errors that are instances of NetworkError will trigger a retry.
 * Other errors (including UserError) are rethrown immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const base = options.base ?? 250;
  const cap = options.cap ?? 5000;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if it is a NetworkError and we have retry attempts left
      if (error instanceof NetworkError && attempt < attempts) {
        let delay = Math.min(cap, base * Math.pow(2, attempt - 1));

        const retryAfterMs = getRetryAfterMs(error);
        if (retryAfterMs !== null) {
          delay = retryAfterMs;
        }

        await sleep(delay);
      } else {
        throw error;
      }
    }
  }

  throw lastError;
}
