import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.hoisted(() => vi.fn());
const shared = vi.hoisted(() => ({
  hasSharedBackend: vi.fn(() => false),
  incrementRateLimitCount: vi.fn(),
  pruneRateLimitBuckets: vi.fn(async () => undefined),
}));

vi.mock('@/lib/logger', () => ({ getLogger: () => ({ warn }) }));
vi.mock('@/lib/api/shared-state', () => shared);

import { checkRateLimit, clearRateLimitStore } from '@/lib/api/rate-limit';

beforeEach(() => {
  warn.mockClear();
  shared.hasSharedBackend.mockReset().mockReturnValue(false);
  shared.incrementRateLimitCount.mockReset();
  clearRateLimitStore();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('rate limiter falls back to per-instance counting (#1368)', () => {
  it('warns once per process in production when there is no shared backend', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await checkRateLimit('1.1.1.1', { bucket: 'b' });
    await checkRateLimit('1.1.1.1', { bucket: 'b' });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ event: 'rate_limit_no_shared_backend' });
  });

  it('does not warn outside production when there is no shared backend', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await checkRateLimit('1.1.1.1', { bucket: 'b' });
    await checkRateLimit('1.1.1.1', { bucket: 'b' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once when the shared backend errors, however many requests follow', async () => {
    shared.hasSharedBackend.mockReturnValue(true);
    shared.incrementRateLimitCount.mockRejectedValue(new Error('connection refused'));

    await checkRateLimit('2.2.2.2', { bucket: 'b' });
    await checkRateLimit('2.2.2.2', { bucket: 'b' });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({
      event: 'rate_limit_shared_backend_error',
      error: 'Error: connection refused',
    });
  });

  it('warns about a backend error again after 60 seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
    shared.hasSharedBackend.mockReturnValue(true);
    shared.incrementRateLimitCount.mockRejectedValue(new Error('down'));

    await checkRateLimit('3.3.3.3', { bucket: 'b' });
    vi.setSystemTime(new Date('2026-10-25T12:00:30Z'));
    await checkRateLimit('3.3.3.3', { bucket: 'b' });
    expect(warn).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-10-25T12:01:01Z'));
    await checkRateLimit('3.3.3.3', { bucket: 'b' });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('resets both throttles in clearRateLimitStore', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await checkRateLimit('4.4.4.4', { bucket: 'b' });
    clearRateLimitStore();
    await checkRateLimit('4.4.4.4', { bucket: 'b' });
    expect(warn).toHaveBeenCalledTimes(2);

    warn.mockClear();
    shared.hasSharedBackend.mockReturnValue(true);
    shared.incrementRateLimitCount.mockRejectedValue(new Error('down'));
    await checkRateLimit('4.4.4.4', { bucket: 'b' });
    clearRateLimitStore();
    await checkRateLimit('4.4.4.4', { bucket: 'b' });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('does not change the allow/deny decision', async () => {
    shared.hasSharedBackend.mockReturnValue(true);
    shared.incrementRateLimitCount.mockRejectedValue(new Error('down'));

    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await checkRateLimit('5.5.5.5', { bucket: 'b', maxRequests: 3 }));
    }

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.every((r) => r.shared === false)).toBe(true);
  });
});
