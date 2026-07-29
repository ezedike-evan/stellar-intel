import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getIdempotentResponse,
  storeIdempotentResponse,
  clearIdempotencyStore,
  IDEMPOTENCY_TTL_MS,
} from '@/lib/api/idempotency';

beforeEach(() => {
  clearIdempotencyStore();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('idempotency store', () => {
  it('returns null for a key that was never stored', () => {
    expect(getIdempotentResponse('unknown-key')).toBeNull();
  });

  it('returns the stored response for a known key', () => {
    storeIdempotentResponse('key-1', 200, { hello: 'world' }, { 'X-Test': '1' });
    const result = getIdempotentResponse('key-1');
    expect(result).not.toBeNull();
    expect(result?.status).toBe(200);
    expect(result?.body).toEqual({ hello: 'world' });
    expect(result?.headers).toEqual({ 'X-Test': '1' });
  });

  it('expires an entry after IDEMPOTENCY_TTL_MS', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    storeIdempotentResponse('key-2', 200, { a: 1 });
    expect(getIdempotentResponse('key-2')).not.toBeNull();

    vi.setSystemTime(new Date(Date.now() + IDEMPOTENCY_TTL_MS + 1));
    expect(getIdempotentResponse('key-2')).toBeNull();
  });

  it('does not expire an entry just under IDEMPOTENCY_TTL_MS', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    storeIdempotentResponse('key-3', 200, { a: 1 });
    vi.setSystemTime(new Date(Date.now() + IDEMPOTENCY_TTL_MS - 1000));
    expect(getIdempotentResponse('key-3')).not.toBeNull();
  });

  it('clearIdempotencyStore removes every entry', () => {
    storeIdempotentResponse('key-4', 200, { a: 1 });
    storeIdempotentResponse('key-5', 400, { code: 'X' });
    clearIdempotencyStore();
    expect(getIdempotentResponse('key-4')).toBeNull();
    expect(getIdempotentResponse('key-5')).toBeNull();
  });
});
