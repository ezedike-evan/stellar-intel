import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProbeLedgerRow } from '@/types/reputation';

// Regression tests for Issue #906.
//
// `getReputationStore()` called `createReputationStore()` with no options, so
// the postgres branch threw `'The postgres backend requires a SqlExecutor'` on
// every call in production. `runProbeSweep()` opens with that call, so the probe
// sweep threw on its first line every 5 minutes and `probe_samples` stayed
// empty — which is the table all three 90-day readiness gates measure.

const ORIGINAL_ENV = { ...process.env };

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV };
}

describe('createReputationStore — postgres executor default (#906)', () => {
  beforeEach(() => {
    vi.resetModules();
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
  });

  it('builds a postgres store without an explicit executor when DATABASE_URL is set', async () => {
    process.env.DATABASE_URL = 'postgres://user:pw@localhost:5432/testdb';

    const { createReputationStore } = await import('@/lib/reputation/store');

    // The regression: this threw before the shared pool was wired in. It must
    // now construct — the pool is lazy, so no connection is opened here.
    expect(() => createReputationStore({ backend: 'postgres' })).not.toThrow();
  });

  it('throws a directed, typed error when the postgres backend has no DATABASE_URL', async () => {
    delete process.env.DATABASE_URL;

    const { createReputationStore, ReputationStoreUnavailableError } =
      await import('@/lib/reputation/store');

    expect(() => createReputationStore({ backend: 'postgres' })).toThrow(
      /DATABASE_URL is required/
    );
    // Typed, not just worded: two read paths degrade on this and used to detect
    // it by string-matching the message, which broke when the message changed.
    expect(() => createReputationStore({ backend: 'postgres' })).toThrow(
      ReputationStoreUnavailableError
    );
  });

  it('tryGetReputationStore() returns null instead of throwing when unconfigured', async () => {
    delete process.env.DATABASE_URL;
    process.env.REPUTATION_BACKEND = 'postgres';

    const { tryGetReputationStore } = await import('@/lib/reputation/store');

    // This is what lets `next build` prerender /anchors/[id] and the leaderboard
    // render with no durable store, rather than failing the whole build.
    expect(tryGetReputationStore()).toBeNull();
  });

  it('tryGetReputationStore() returns a store when one can be built', async () => {
    process.env.REPUTATION_BACKEND = 'memory';

    const { tryGetReputationStore } = await import('@/lib/reputation/store');

    expect(tryGetReputationStore()).not.toBeNull();
  });

  it('tryGetReputationStore() still propagates unrelated failures', async () => {
    process.env.REPUTATION_BACKEND = 'not-a-real-backend';

    const { tryGetReputationStore } = await import('@/lib/reputation/store');

    // Degrading is only correct for "no store configured". A typo in
    // REPUTATION_BACKEND must not silently render an empty leaderboard.
    expect(() => tryGetReputationStore()).toThrow(/Unknown reputation store backend/);
  });

  it('still honours an explicitly injected executor', async () => {
    const executor = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    const { createReputationStore } = await import('@/lib/reputation/store');
    const store = createReputationStore({ backend: 'postgres', executor });

    expect(store).toBeDefined();
    // No pool involved: the injected fake is used verbatim, so tests never need
    // a DATABASE_URL.
    expect(executor.query).not.toHaveBeenCalled();
  });

  it('getReputationStore() resolves postgres in production without throwing', async () => {
    process.env.DATABASE_URL = 'postgres://user:pw@localhost:5432/testdb';
    delete process.env.REPUTATION_BACKEND;

    const { getReputationStore } = await import('@/lib/reputation/store');

    // This is the exact call `runProbeSweep()` makes on its first line.
    expect(() => getReputationStore()).not.toThrow();
  });
});

describe('DurableProbeStore persist accounting (#906)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('counts successful writes', async () => {
    const { DurableProbeStore } = await import('@/lib/reputation/probe');
    const rows: ProbeLedgerRow[] = [];
    const sink = {
      recordProbeSample: async (row: ProbeLedgerRow) => {
        rows.push(row);
      },
    };

    const store = new DurableProbeStore(sink, 'uptime');
    store.record({ domain: 'a.example', reachable: true, latencyMs: 12, at: Date.now() });
    store.record({ domain: 'b.example', reachable: false, latencyMs: 0, at: Date.now() });
    await store.drain();

    expect(store.persisted).toBe(2);
    expect(store.failed).toBe(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.kind).toBe('uptime');
  });

  it('counts rejected writes instead of silently swallowing them', async () => {
    const { DurableProbeStore } = await import('@/lib/reputation/probe');
    const sink = {
      recordProbeSample: async () => {
        throw new Error('connection refused');
      },
    };

    const store = new DurableProbeStore(sink, 'quote');
    store.record({ domain: 'a.example', reachable: true, latencyMs: 5, at: Date.now() });
    await store.drain();

    // Before #906 a rejected write was caught and logged with no counter, so a
    // sweep that persisted nothing was indistinguishable from a healthy one.
    expect(store.persisted).toBe(0);
    expect(store.failed).toBe(1);
  });

  it('drain() does not reject when a write fails', async () => {
    const { DurableProbeStore } = await import('@/lib/reputation/probe');
    const sink = {
      recordProbeSample: async () => {
        throw new Error('boom');
      },
    };

    const store = new DurableProbeStore(sink, 'toml-integrity');
    store.record({ domain: 'a.example', reachable: true, latencyMs: 1, at: Date.now() });

    await expect(store.drain()).resolves.toBeUndefined();
  });
});
