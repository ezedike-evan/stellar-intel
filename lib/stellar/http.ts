/**
 * `fetch()` with an AbortController-based timeout.
 *
 * Aborts the request after `ms` milliseconds and always clears the timer. The
 * underlying `AbortError` propagates unchanged so callers can translate it into
 * an endpoint-specific message. Any `signal` passed in `init` is overridden.
 */
export async function fetchWithTimeout(
  url: string,
  ms: number,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}
