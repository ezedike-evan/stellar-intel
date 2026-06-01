import { NetworkError } from './errors'

interface RetryOptions {
  attempts?: number
  base?: number
  cap?: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Helper to extract Retry-After duration in milliseconds.
 * Supports:
 * - Direct numeric / string retryAfter properties
 * - headers/response.headers check (e.g. headers.get('Retry-After') or headers['retry-after'])
 * - Handles both number-of-seconds and HTTP date string formats.
 */
function getRetryAfterMs(error: any): number | null {
  if (!error || typeof error !== 'object') return null

  // 1. Direct retryAfter / retry_after property
  if (typeof error.retryAfter === 'number') {
    return error.retryAfter
  }
  if (typeof error.retryAfter === 'string') {
    const ms = parseRetryAfterValue(error.retryAfter)
    if (ms !== null) return ms
  }
  if (typeof error.retry_after === 'number') {
    return error.retry_after
  }
  if (typeof error.retry_after === 'string') {
    const ms = parseRetryAfterValue(error.retry_after)
    if (ms !== null) return ms
  }

  // 2. Error headers
  if (error.headers) {
    const ms = getRetryAfterFromHeaders(error.headers)
    if (ms !== null) return ms
  }

  // 3. Error response headers
  if (error.response && typeof error.response === 'object') {
    if (error.response.headers) {
      const ms = getRetryAfterFromHeaders(error.response.headers)
      if (ms !== null) return ms
    }
  }

  return null
}

function getRetryAfterFromHeaders(headers: any): number | null {
  if (!headers) return null
  let value: string | null = null

  if (typeof headers.get === 'function') {
    value = headers.get('Retry-After') || headers.get('retry-after')
  } else if (typeof headers === 'object') {
    value = headers['Retry-After'] || headers['retry-after'] || null
  }

  if (value) {
    return parseRetryAfterValue(value)
  }
  return null
}

function parseRetryAfterValue(value: string): number | null {
  // Positive integer (seconds)
  if (/^\d+$/.test(value)) {
    return parseInt(value, 10) * 1000
  }
  // Date string
  const dateMs = Date.parse(value)
  if (!isNaN(dateMs)) {
    const delay = dateMs - Date.now()
    return delay > 0 ? delay : 0
  }
  return null
}

/**
 * Runs the promise-returning function `fn` with exponential backoff retries.
 * Only errors that are instances of NetworkError will trigger a retry.
 * Other errors (including UserError) are rethrown immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const attempts = options.attempts ?? 3
  const base = options.base ?? 250
  const cap = options.cap ?? 5000

  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // Check if it is a NetworkError and we have retry attempts left
      if (error instanceof NetworkError && attempt < attempts) {
        let delay = Math.min(cap, base * Math.pow(2, attempt - 1))

        const retryAfterMs = getRetryAfterMs(error)
        if (retryAfterMs !== null) {
          delay = retryAfterMs
        }

        await sleep(delay)
      } else {
        throw error
      }
    }
  }

  throw lastError
}
