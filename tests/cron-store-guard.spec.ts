import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkDurableStore } from '@/lib/api/store-guard';
import { _setReputationStore, InMemoryReputationStore } from '@/lib/reputation/store';

afterEach(() => {
  vi.unstubAllEnvs();
  _setReputationStore(null);
});

describe('checkDurableStore', () => {
  it('returns 503 STORE_UNAVAILABLE when no durable store is configured', async () => {
    // Production with no DATABASE_URL: `resolveBackend` picks postgres, the
    // pool refuses to build, and the cron routes used to report that as an
    // opaque INTERNAL_ERROR 500.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('REPUTATION_BACKEND', '');

    const res = checkDurableStore();
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    await expect(res!.json()).resolves.toMatchObject({
      code: 'STORE_UNAVAILABLE',
      durable: false,
    });
  });

  it('returns null when a store can be built', () => {
    _setReputationStore(new InMemoryReputationStore());
    expect(checkDurableStore()).toBeNull();
  });

  it('propagates a misconfigured backend instead of degrading', () => {
    // A typo in REPUTATION_BACKEND is a fault, not an absent database, and must
    // stay loud — the guard only swallows ReputationStoreUnavailableError.
    vi.stubEnv('REPUTATION_BACKEND', 'postgress');
    expect(() => checkDurableStore()).toThrow(/Unknown reputation store backend/);
  });
});
