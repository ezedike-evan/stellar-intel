import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, clearRateLimitStore } from '@/lib/api/rate-limit';

describe('Rate limiting', () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it('allows first request', () => {
    const result = checkRateLimit('1.2.3.4');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(59);
  });

  it('returns 429 after 60 requests', () => {
    for (let i = 0; i < 60; i++) {
      checkRateLimit('1.2.3.5');
    }
    const result = checkRateLimit('1.2.3.5');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('different IPs have independent limits', () => {
    for (let i = 0; i < 60; i++) {
      checkRateLimit('10.0.0.1');
    }
    const result = checkRateLimit('10.0.0.2');
    expect(result.allowed).toBe(true);
  });

  it('provides Retry-After > 0 when rate limited', () => {
    for (let i = 0; i < 61; i++) {
      checkRateLimit('5.5.5.5');
    }
    const result = checkRateLimit('5.5.5.5');
    expect(result.retryAfter).toBeGreaterThan(0);
  });
});

describe('Lock mechanism', () => {
  it('acquires lock on first call', async () => {
    const { acquireLock, releaseLock } = await import('@/lib/reputation/lock');
    const acquired = acquireLock('test-lock');
    expect(acquired).toBe(true);
    releaseLock('test-lock');
  });

  it('blocks second acquisition while locked', async () => {
    const { acquireLock, releaseLock } = await import('@/lib/reputation/lock');
    acquireLock('test-lock-2');
    const second = acquireLock('test-lock-2');
    expect(second).toBe(false);
    releaseLock('test-lock-2');
  });

  it('allows re-acquisition after release', async () => {
    const { acquireLock, releaseLock } = await import('@/lib/reputation/lock');
    acquireLock('test-lock-3');
    releaseLock('test-lock-3');
    const reacquired = acquireLock('test-lock-3');
    expect(reacquired).toBe(true);
    releaseLock('test-lock-3');
  });
});
