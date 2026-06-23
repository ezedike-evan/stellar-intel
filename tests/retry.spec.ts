import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '@/lib/stellar/retry';
import { NetworkError, UserError } from '@/lib/stellar/errors';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves immediately when the operation succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on NetworkError and succeeds when subsequent attempt is successful', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new NetworkError('Fail 1'))
      .mockRejectedValueOnce(new NetworkError('Fail 2'))
      .mockResolvedValueOnce('success');

    const promise = withRetry(fn, { attempts: 3, base: 100 });

    // Fast-forward timers for first retry (delay = 100ms)
    await vi.advanceTimersByTimeAsync(100);
    // Fast-forward timers for second retry (delay = 200ms)
    await vi.advanceTimersByTimeAsync(200);

    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('fails after exhausting attempts for a permanent NetworkError', async () => {
    const fn = vi.fn().mockRejectedValue(new NetworkError('Fail'));
    const promise = withRetry(fn, { attempts: 3, base: 100 });
    // Attach a handler now so the eventual rejection isn't flagged as unhandled
    // while we advance fake timers below.
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);

    await expect(promise).rejects.toThrow(NetworkError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry and rejects immediately on UserError', async () => {
    const fn = vi.fn().mockRejectedValue(new UserError('User bad input'));
    const promise = withRetry(fn, { attempts: 3, base: 100 });

    await expect(promise).rejects.toThrow(UserError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry and rejects immediately on generic Error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Generic failure'));
    const promise = withRetry(fn, { attempts: 3, base: 100 });

    await expect(promise).rejects.toThrow(Error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honors exponential backoff capped by the cap value', async () => {
    const fn = vi.fn().mockRejectedValue(new NetworkError('Fail'));
    const promise = withRetry(fn, { attempts: 5, base: 100, cap: 300 });
    // Attach a handler now so the eventual rejection isn't flagged as unhandled
    // while we advance fake timers below.
    promise.catch(() => {});

    // Attempt 1: fails
    // Delay 1: min(300, 100 * 2^0) = 100ms
    await vi.advanceTimersByTimeAsync(100);

    // Attempt 2: fails
    // Delay 2: min(300, 100 * 2^1) = 200ms
    await vi.advanceTimersByTimeAsync(200);

    // Attempt 3: fails
    // Delay 3: min(300, 100 * 2^2) = 300ms (capped)
    await vi.advanceTimersByTimeAsync(300);

    // Attempt 4: fails
    // Delay 4: min(300, 100 * 2^3) = 300ms (capped)
    await vi.advanceTimersByTimeAsync(300);

    await expect(promise).rejects.toThrow(NetworkError);
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('honors Retry-After header with a numeric string (seconds)', async () => {
    const err = new NetworkError('Rate limited');
    (err as any).headers = { 'Retry-After': '5' }; // 5 seconds = 5000ms

    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('success');

    const promise = withRetry(fn, { attempts: 3, base: 100 });

    // Wait less than 5000ms, should not have completed yet
    await vi.advanceTimersByTimeAsync(4000);
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance remaining time
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After header format (lowercase / get method) on response', async () => {
    const err = new NetworkError('Rate limited');
    const headersMap = new Map<string, string>();
    headersMap.set('retry-after', '2');
    (err as any).response = {
      headers: {
        get: (name: string) => headersMap.get(name.toLowerCase()) || null,
      },
    };

    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('success');

    const promise = withRetry(fn, { attempts: 3, base: 100 });

    await vi.advanceTimersByTimeAsync(1999);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After header with an HTTP date string', async () => {
    const err = new NetworkError('Rate limited');
    const futureDate = new Date(Date.now() + 8000);
    (err as any).retryAfter = futureDate.toUTCString();

    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('success');

    const promise = withRetry(fn, { attempts: 3, base: 100 });

    // Wait less than 8000ms
    await vi.advanceTimersByTimeAsync(7000);
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance remaining time
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
