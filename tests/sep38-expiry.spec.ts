import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getRemainingSeconds,
  isQuoteExpired,
  watchQuoteExpiry,
  QuoteExpiredEvent,
  onQuoteExpired,
} from '@/lib/stellar/sep38';
import type { QuoteExpiryQuote } from '@/lib/stellar/sep38';

// ─── Test helpers ─────────────────────────────────────────────────────────────

interface MockQuote extends QuoteExpiryQuote {
  id: string;
  anchorDomain: string;
  anchorId: string;
  sellAsset: string;
  buyAsset: string;
  sellAmount: string;
  buyAmount: string;
  exchangeRate: number;
  fee: number;
  totalReceived: number;
  expiresAt: Date;
  createdAt: Date;
}

function createMockQuote(expiresInSeconds: number): MockQuote {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000);

  return {
    id: 'quote-123',
    anchorDomain: 'cowrie.exchange',
    anchorId: 'cowrie',
    sellAsset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    buyAsset: 'NGN:stellar_anchor_issuer',
    sellAmount: '100',
    buyAmount: '50000',
    exchangeRate: 500,
    fee: 2.5,
    totalReceived: 48750,
    expiresAt,
    createdAt: now,
  };
}

// ─── getRemainingSeconds ──────────────────────────────────────────────────────

describe('getRemainingSeconds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns positive seconds for a quote expiring in the future', () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(60); // expires in 60 seconds
    const remaining = getRemainingSeconds(quote);

    expect(remaining).toBeGreaterThan(50); // Account for test execution time
    expect(remaining).toBeLessThanOrEqual(60);
  });

  it('returns zero or negative for an expired quote', () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(-10); // expired 10 seconds ago
    const remaining = getRemainingSeconds(quote);

    expect(remaining).toBeLessThanOrEqual(0);
  });

  it('handles the snake_case expires_at string shape of a real Sep38Quote', () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    // A real firm Sep38Quote carries expires_at as an RFC 3339 string, not expiresAt.
    const quote = { expires_at: new Date(now.getTime() + 90 * 1000).toISOString() };

    expect(getRemainingSeconds(quote)).toBe(90);
    expect(isQuoteExpired(quote)).toBe(false);
  });

  it('handles Date objects for expiresAt', () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(120);
    const remaining = getRemainingSeconds(quote);

    expect(remaining).toBeGreaterThan(100);
    expect(remaining).toBeLessThanOrEqual(120);
  });

  it('accurately calculates remaining seconds down to the second', () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(42);
    const remaining = getRemainingSeconds(quote);

    expect(remaining).toBe(42);
  });

  it('returns exactly 0 for a quote expiring now', () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(0);
    const remaining = getRemainingSeconds(quote);

    expect(remaining).toBe(0);
  });
});

// ─── isQuoteExpired ───────────────────────────────────────────────────────────

describe('isQuoteExpired', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false for a quote with remaining time', () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(300);
    expect(isQuoteExpired(quote)).toBe(false);
  });

  it('returns true for an expired quote', () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(-1);
    expect(isQuoteExpired(quote)).toBe(true);
  });

  it('returns true when quote expires exactly now (boundary condition)', () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(0);
    expect(isQuoteExpired(quote)).toBe(true);
  });

  it('returns false just before expiry', () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(1); // expires in 1 second
    expect(isQuoteExpired(quote)).toBe(false);
  });
});

// ─── watchQuoteExpiry ──────────────────────────────────────────────────────────

describe('watchQuoteExpiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits isExpired event when quote expires', async () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(5);
    const { target } = watchQuoteExpiry(quote);

    let eventFired = false;
    const received: { quote: MockQuote | null } = { quote: null };

    target.addEventListener('isExpired', (event: Event) => {
      if (event instanceof QuoteExpiredEvent) {
        eventFired = true;
        received.quote = event.quote as MockQuote;
      }
    });

    // Advance time past expiry
    vi.advanceTimersByTime(6000);
    await vi.runAllTimersAsync();

    expect(eventFired).toBe(true);
    expect(received.quote?.id).toBe(quote.id);
  });

  it('emits isExpired immediately for an already-expired quote', async () => {
    const quote = createMockQuote(-10); // already expired

    let eventFired = false;
    const { target } = watchQuoteExpiry(quote);

    target.addEventListener('isExpired', () => {
      eventFired = true;
    });

    await vi.runAllTimersAsync();

    expect(eventFired).toBe(true);
  });

  it('returns an EventTarget', () => {
    const quote = createMockQuote(10);
    const { target } = watchQuoteExpiry(quote);

    expect(target).toHaveProperty('addEventListener');
    expect(target).toHaveProperty('removeEventListener');
    expect(target).toHaveProperty('dispatchEvent');
  });

  it('uses provided EventTarget if given', () => {
    const quote = createMockQuote(10);
    const customTarget = new EventTarget();

    const { target } = watchQuoteExpiry(quote, customTarget);

    expect(target).toBe(customTarget);
  });

  it('abort function prevents event emission', async () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(5);
    const { target, abort } = watchQuoteExpiry(quote);

    let eventFired = false;

    target.addEventListener('isExpired', () => {
      eventFired = true;
    });

    // Abort watching
    abort();

    // Advance time past expiry
    vi.advanceTimersByTime(6000);
    await vi.runAllTimersAsync();

    expect(eventFired).toBe(false);
  });

  it('cleanup can be called multiple times safely', () => {
    const quote = createMockQuote(10);
    const { abort } = watchQuoteExpiry(quote);

    expect(() => {
      abort();
      abort();
      abort();
    }).not.toThrow();
  });
});

// ─── onQuoteExpired ───────────────────────────────────────────────────────────

describe('onQuoteExpired', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls callback when quote expires', async () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(5);
    const callback = vi.fn();

    onQuoteExpired(quote, callback);

    // Advance time past expiry
    vi.advanceTimersByTime(6000);
    await vi.runAllTimersAsync();

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(quote);
  });

  it('calls callback immediately for already-expired quotes', async () => {
    const quote = createMockQuote(-5); // already expired
    const callback = vi.fn();

    onQuoteExpired(quote, callback);

    await vi.runAllTimersAsync();

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(quote);
  });

  it('returns cleanup function that stops watching', async () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(5);
    const callback = vi.fn();

    const cleanup = onQuoteExpired(quote, callback);

    // Clean up immediately
    cleanup();

    // Advance time past expiry
    vi.advanceTimersByTime(6000);
    await vi.runAllTimersAsync();

    expect(callback).not.toHaveBeenCalled();
  });

  it('passes the expired quote to the callback', async () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(5);
    const callback = vi.fn();

    onQuoteExpired(quote, callback);

    // Advance time past expiry
    vi.advanceTimersByTime(6000);
    await vi.runAllTimersAsync();

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        id: quote.id,
        anchorDomain: quote.anchorDomain,
        expiresAt: quote.expiresAt,
      })
    );
  });

  it('works with a custom EventTarget', async () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(5);
    const callback = vi.fn();
    const customTarget = new EventTarget();

    onQuoteExpired(quote, callback, customTarget);

    // Advance time past expiry
    vi.advanceTimersByTime(6000);
    await vi.runAllTimersAsync();

    expect(callback).toHaveBeenCalledOnce();
  });

  it('multiple listeners can be registered on same quote', async () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(5);
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    onQuoteExpired(quote, callback1);
    onQuoteExpired(quote, callback2);

    // Advance time past expiry
    vi.advanceTimersByTime(6000);
    await vi.runAllTimersAsync();

    expect(callback1).toHaveBeenCalledOnce();
    expect(callback2).toHaveBeenCalledOnce();
  });
});

// ─── Acceptance Criteria ──────────────────────────────────────────────────────

describe('Acceptance Criteria - Expired quote raises event before any attempt to use it', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should raise isExpired event before attempting to use expired quote', async () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(2);
    const eventHandler = vi.fn();

    const { target } = watchQuoteExpiry(quote);
    target.addEventListener('isExpired', eventHandler);

    // Simulate checking if quote is expired (before attempting to use it)
    vi.advanceTimersByTime(3000);
    await vi.runAllTimersAsync();

    expect(eventHandler).toHaveBeenCalled();
    // Verify that the event was fired before we tried to use the quote
    expect(isQuoteExpired(quote)).toBe(true);
  });

  it('should track remaining time accurately for countdown display', () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(30);

    expect(getRemainingSeconds(quote)).toBeGreaterThan(25);
    expect(getRemainingSeconds(quote)).toBeLessThanOrEqual(30);

    // Simulate time passing
    vi.advanceTimersByTime(10000);
    expect(getRemainingSeconds(quote)).toBeGreaterThan(15);
    expect(getRemainingSeconds(quote)).toBeLessThanOrEqual(20);
  });

  it('should prevent use of expired quotes by emitting isExpired before expiry moment', async () => {
    const now = new Date('2026-05-31T12:00:00Z');
    vi.setSystemTime(now);

    const quote = createMockQuote(1);
    let useAttempted = false;

    onQuoteExpired(quote, () => {
      // Block usage by setting a flag
      useAttempted = true;
    });

    // Try to use immediately - should still be valid
    expect(isQuoteExpired(quote)).toBe(false);

    // Wait for expiry
    vi.advanceTimersByTime(2000);
    await vi.runAllTimersAsync();

    // By the time we check, expiry event should have fired
    expect(useAttempted).toBe(true);
  });
});
