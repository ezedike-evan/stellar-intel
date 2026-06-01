interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateLimitEntry>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
}

export function checkRateLimit(ip: string): RateLimitResult {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    store.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: MAX_REQUESTS - 1, retryAfter: 0 };
  }

  if (entry.count >= MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  entry.count += 1;
  return { allowed: true, remaining: MAX_REQUESTS - entry.count, retryAfter: 0 };
}

export function clearRateLimitStore(): void {
  store.clear();
}
