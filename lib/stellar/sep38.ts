import type { Sep38Quote } from '@/types'

// ─── Quote expiry tracking ────────────────────────────────────────────────────

/**
 * Calculates the remaining seconds until a quote expires.
 * Returns a negative value if the quote has already expired.
 *
 * @param quote - The SEP-38 quote to check
 * @returns Number of seconds remaining until expiry, or negative if expired
 */
export function getRemainingSeconds(quote: Sep38Quote): number {
  const now = new Date()
  const expiresAtTime = quote.expiresAt instanceof Date
    ? quote.expiresAt.getTime()
    : new Date(quote.expiresAt).getTime()
  const nowTime = now.getTime()
  return Math.floor((expiresAtTime - nowTime) / 1000)
}

/**
 * Checks if a quote has expired based on the current time.
 *
 * @param quote - The SEP-38 quote to check
 * @returns true if the quote has expired, false otherwise
 */
export function isQuoteExpired(quote: Sep38Quote): boolean {
  return getRemainingSeconds(quote) <= 0
}

// ─── Quote expiry event emitter ───────────────────────────────────────────────

/**
 * Custom event for quote expiry.
 * Emitted when a watched quote expires before any attempt to use it.
 */
export class QuoteExpiredEvent extends Event {
  readonly quote: Sep38Quote

  constructor(quote: Sep38Quote) {
    super('isExpired', { bubbles: true })
    this.quote = quote
  }
}

/**
 * Watches a quote for expiry and emits an event when it expires.
 * Returns a cleanup function to cancel the watch.
 *
 * @param quote - The SEP-38 quote to watch
 * @param target - Optional EventTarget to emit the event on (defaults to a new EventTarget)
 * @returns An object with the EventTarget and an abort function to stop watching
 */
export function watchQuoteExpiry(
  quote: Sep38Quote,
  target?: EventTarget
): { target: EventTarget; abort: () => void } {
  const emitter = target || new EventTarget()
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let aborted = false

  function scheduleExpiry() {
    const remaining = getRemainingSeconds(quote)

    // If already expired, emit immediately
    if (remaining <= 0) {
      if (!aborted) {
        emitter.dispatchEvent(new QuoteExpiredEvent(quote))
      }
      return
    }

    // Schedule expiry check for when the quote should expire
    // Add a small buffer (100ms) to ensure we catch it after it expires
    timeoutId = setTimeout(() => {
      if (!aborted) {
        emitter.dispatchEvent(new QuoteExpiredEvent(quote))
      }
    }, (remaining + 0.1) * 1000)
  }

  scheduleExpiry()

  return {
    target: emitter,
    abort: () => {
      aborted = true
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    },
  }
}

/**
 * Adds a listener for quote expiry events on the given target.
 * Automatically raises an error (through the event) before any attempt to use the quote.
 *
 * @param quote - The SEP-38 quote to monitor
 * @param callback - Function to call when the quote expires
 * @param target - Optional EventTarget to listen on (defaults to a new EventTarget)
 * @returns A cleanup function to remove the listener and stop watching
 */
export function onQuoteExpired(
  quote: Sep38Quote,
  callback: (expiredQuote: Sep38Quote) => void,
  target?: EventTarget
): () => void {
  const { target: emitter, abort } = watchQuoteExpiry(quote, target)

  const listener = (event: Event) => {
    if (event instanceof QuoteExpiredEvent) {
      callback(event.quote)
    }
  }

  emitter.addEventListener('isExpired', listener)

  return () => {
    emitter.removeEventListener('isExpired', listener)
    abort()
  }
}
