import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryRecord, WebhookEvent, WebhookSubscription } from '@/lib/webhooks/types';

// Tests for the Postgres-backed webhook store (#1337).
//
// Drives the store with a fake executor, in the style of shared-state.spec.ts,
// and asserts the contracts the routes rely on. The fake returns TIMESTAMPTZ
// columns as Date objects, as pg does, so a missing ISO conversion shows up.

const ORIGINAL_ENV = { ...process.env };

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV };
}

/** Minimal in-memory stand-in for the two webhook tables. */
function makeFakeDb() {
  const subs = new Map<string, Record<string, unknown>>();
  const deliveries: Record<string, unknown>[] = [];
  const events = new Map<string, Record<string, unknown>>();

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('CREATE TABLE')) return { rows: [] };

    if (sql.includes('INSERT INTO webhook_events')) {
      // ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
      const [id, idempotencyKey, kind, body, createdAt] = params as [
        string,
        string,
        string,
        string,
        string,
      ];
      const taken = [...events.values()].some((e) => e['idempotency_key'] === idempotencyKey);
      if (taken || events.has(id)) return { rows: [] };
      events.set(id, {
        id,
        idempotency_key: idempotencyKey,
        kind,
        body,
        created_at: new Date(createdAt),
      });
      return { rows: [{ id }] };
    }

    if (sql.includes('FROM webhook_events WHERE id = $1')) {
      const row = events.get((params as [string])[0]);
      return { rows: row ? [row] : [] };
    }

    if (sql.includes('INSERT INTO webhook_subscriptions')) {
      const [id, url, secret, events, createdAt] = params as [
        string,
        string,
        string,
        string,
        string,
      ];
      subs.set(id, { id, url, secret, events, created_at: new Date(createdAt) });
      return { rows: [] };
    }

    if (sql.includes('DELETE FROM webhook_subscriptions')) {
      const id = (params as [string])[0];
      return { rows: subs.delete(id) ? [{ id }] : [] };
    }

    if (sql.includes('FROM webhook_subscriptions WHERE id = $1')) {
      const row = subs.get((params as [string])[0]);
      return { rows: row ? [row] : [] };
    }

    if (sql.includes('FROM webhook_subscriptions')) {
      return { rows: [...subs.values()] };
    }

    if (sql.includes('INSERT INTO webhook_delivery_log')) {
      const [
        id,
        eventId,
        eventKind,
        subscriptionId,
        url,
        status,
        attempts,
        lastStatusCode,
        lastError,
        deliveredAt,
        createdAt,
      ] = params as [
        string,
        string,
        string,
        string,
        string,
        string,
        number,
        number | null,
        string | null,
        string | null,
        string,
      ];
      deliveries.push({
        id,
        event_id: eventId,
        event_kind: eventKind,
        subscription_id: subscriptionId,
        url,
        status,
        attempts,
        last_status_code: lastStatusCode,
        last_error: lastError,
        delivered_at: deliveredAt == null ? null : new Date(deliveredAt),
        created_at: new Date(createdAt),
      });
      return { rows: [] };
    }

    if (sql.includes('FROM webhook_delivery_log')) {
      if (sql.includes("status = 'dead_letter'")) {
        const rows = deliveries
          .filter((d) => d['status'] === 'dead_letter')
          .sort(
            (a, b) => (b['created_at'] as Date).getTime() - (a['created_at'] as Date).getTime()
          );
        return { rows };
      }
      let rows = [...deliveries];
      if (sql.includes('status = $')) {
        const match = /status = \$(\d+)/.exec(sql);
        if (match) {
          const idx = parseInt(match[1]!, 10) - 1;
          rows = rows.filter((d) => d['status'] === params[idx]);
        }
      }
      if (sql.includes('subscription_id = $')) {
        const match = /subscription_id = \$(\d+)/.exec(sql);
        if (match) {
          const idx = parseInt(match[1]!, 10) - 1;
          rows = rows.filter((d) => d['subscription_id'] === params[idx]);
        }
      }
      if (sql.includes('event_id = $')) {
        const match = /event_id = \$(\d+)/.exec(sql);
        if (match) {
          const idx = parseInt(match[1]!, 10) - 1;
          rows = rows.filter((d) => d['event_id'] === params[idx]);
        }
      }
      rows.sort(
        (a, b) => (b['created_at'] as Date).getTime() - (a['created_at'] as Date).getTime()
      );
      const limitMatch = /LIMIT \$(\d+)/.exec(sql);
      if (limitMatch) {
        const idx = parseInt(limitMatch[1]!, 10) - 1;
        const limit = Number(params[idx]);
        rows = rows.slice(0, limit);
      }
      return { rows };
    }

    return { rows: [] };
  });

  return { query };
}

async function loadWithFakeDb() {
  process.env.DATABASE_URL = 'postgres://user:pw@localhost:5432/testdb';
  const db = makeFakeDb();

  vi.doMock('@/lib/reputation/pool', () => ({
    getSqlExecutor: () => db,
    getPool: () => db,
    hasDatabaseUrl: () => true,
    ReputationStoreUnavailableError: class extends Error {},
    _resetPool: async () => {},
  }));

  const { PostgresWebhookStore } = await import('@/lib/webhooks/postgres');
  return { db, store: new PostgresWebhookStore() };
}

const SUB: WebhookSubscription = {
  id: 'sub-1',
  url: 'https://example.com/hook',
  secret: 'whsec_test',
  events: ['intent.created', 'intent.failed'],
  createdAt: '2026-09-26T10:00:00.000Z',
};

function delivery(overrides: Partial<DeliveryRecord>): DeliveryRecord {
  return {
    id: 'd-1',
    eventId: 'evt-1',
    eventKind: 'intent.failed',
    subscriptionId: 'sub-1',
    url: 'https://example.com/hook',
    status: 'dead_letter',
    attempts: 5,
    lastStatusCode: 500,
    lastError: 'HTTP 500',
    deliveredAt: null,
    createdAt: '2026-09-26T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  resetEnv();
});

afterEach(() => {
  vi.doUnmock('@/lib/reputation/pool');
  resetEnv();
});

describe('PostgresWebhookStore (#1337)', () => {
  it('round-trips a subscription with events as an array', async () => {
    const { store } = await loadWithFakeDb();

    await store.saveSubscription(SUB);

    expect(await store.listSubscriptions()).toEqual([SUB]);
    expect(await store.getSubscription('sub-1')).toEqual(SUB);
  });

  it('returns null for an unknown subscription id', async () => {
    const { store } = await loadWithFakeDb();

    expect(await store.getSubscription('missing')).toBeNull();
  });

  it('reports a delete as true once, then false', async () => {
    const { store } = await loadWithFakeDb();
    await store.saveSubscription(SUB);

    expect(await store.deleteSubscription('sub-1')).toBe(true);
    expect(await store.deleteSubscription('sub-1')).toBe(false);
  });

  it('lists only dead letters, newest first', async () => {
    const { store } = await loadWithFakeDb();

    await store.recordDelivery(
      delivery({
        id: 'ok',
        status: 'success',
        lastStatusCode: 200,
        lastError: null,
        deliveredAt: '2026-09-26T10:00:01.000Z',
      })
    );
    await store.recordDelivery(delivery({ id: 'dl-old', createdAt: '2026-09-26T09:00:00.000Z' }));
    await store.recordDelivery(delivery({ id: 'dl-new', createdAt: '2026-09-26T11:00:00.000Z' }));

    const dead = await store.listDeadLetters();

    expect(dead.map((d) => d.id)).toEqual(['dl-new', 'dl-old']);
    expect(dead[0]).toEqual(delivery({ id: 'dl-new', createdAt: '2026-09-26T11:00:00.000Z' }));
  });

  describe('listDeliveries', () => {
    it('builds parameterized SQL with $1-style params and no interpolated filter values', async () => {
      const { store, db } = await loadWithFakeDb();

      await store.listDeliveries({
        status: 'success',
        subscriptionId: 'sub-test-123',
        eventId: 'evt-test-456',
        limit: 50,
      });

      const selectCalls = db.query.mock.calls.filter(([sql]) =>
        String(sql).includes('FROM webhook_delivery_log')
      );
      expect(selectCalls).toHaveLength(1);
      const [sql, params] = selectCalls[0] as [string, unknown[]];

      // Verifies parameterized WHERE with $1, $2, $3, $4
      expect(sql).toContain('WHERE status = $1 AND subscription_id = $2 AND event_id = $3');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(sql).toContain('LIMIT $4');

      // Verifies values are passed via params array, not interpolated into SQL
      expect(params).toEqual(['success', 'sub-test-123', 'evt-test-456', 50]);
      expect(sql).not.toContain('sub-test-123');
      expect(sql).not.toContain('evt-test-456');
      expect(sql).not.toContain("'success'");
    });

    it('maps only provided filters to WHERE clauses', async () => {
      const { store, db } = await loadWithFakeDb();

      // No filters: no WHERE clause, limit is $1 defaulting to 100
      await store.listDeliveries({});
      const call1 = db.query.mock.calls[db.query.mock.calls.length - 1] as [string, unknown[]];
      expect(call1[0]).not.toContain('WHERE');
      expect(call1[0]).toContain('LIMIT $1');
      expect(call1[1]).toEqual([100]);

      // Only status
      await store.listDeliveries({ status: 'failed' });
      const call2 = db.query.mock.calls[db.query.mock.calls.length - 1] as [string, unknown[]];
      expect(call2[0]).toContain('WHERE status = $1');
      expect(call2[0]).toContain('LIMIT $2');
      expect(call2[1]).toEqual(['failed', 100]);

      // Only subscriptionId
      await store.listDeliveries({ subscriptionId: 'sub-abc' });
      const call3 = db.query.mock.calls[db.query.mock.calls.length - 1] as [string, unknown[]];
      expect(call3[0]).toContain('WHERE subscription_id = $1');
      expect(call3[0]).toContain('LIMIT $2');
      expect(call3[1]).toEqual(['sub-abc', 100]);

      // Only eventId
      await store.listDeliveries({ eventId: 'evt-xyz' });
      const call4 = db.query.mock.calls[db.query.mock.calls.length - 1] as [string, unknown[]];
      expect(call4[0]).toContain('WHERE event_id = $1');
      expect(call4[0]).toContain('LIMIT $2');
      expect(call4[1]).toEqual(['evt-xyz', 100]);
    });

    it('clamps limit between 1 and 500', async () => {
      const { store, db } = await loadWithFakeDb();

      await store.listDeliveries({ limit: 1000 });
      const high = db.query.mock.calls[db.query.mock.calls.length - 1] as [string, unknown[]];
      expect(high[1]).toEqual([500]);

      await store.listDeliveries({ limit: 0 });
      const low = db.query.mock.calls[db.query.mock.calls.length - 1] as [string, unknown[]];
      expect(low[1]).toEqual([1]);
    });

    it('returns filtered records newest first with ISO timestamps', async () => {
      const { store } = await loadWithFakeDb();

      await store.recordDelivery(
        delivery({ id: 'd-old', status: 'success', createdAt: '2026-09-26T09:00:00.000Z' })
      );
      await store.recordDelivery(
        delivery({ id: 'd-new', status: 'success', createdAt: '2026-09-26T11:00:00.000Z' })
      );
      await store.recordDelivery(
        delivery({ id: 'd-fail', status: 'failed', createdAt: '2026-09-26T10:00:00.000Z' })
      );

      const results = await store.listDeliveries({ status: 'success' });
      expect(results.map((r) => r.id)).toEqual(['d-new', 'd-old']);
      expect(results[0]?.createdAt).toBe('2026-09-26T11:00:00.000Z');
    });
  });

  describe('webhook events (WHK004)', () => {
    const EVENT: WebhookEvent = {
      id: '3f2a1b4c-0d5e-4f6a-8b7c-9d0e1f2a3b4c',
      kind: 'intent.failed',
      createdAt: '2026-11-20T12:00:00.000Z',
      idempotencyKey: 'intent.failed:abc',
      payload: { intentHash: 'a'.repeat(64), anchorId: 'cowrie', corridor: 'usdc-ngn' },
    };

    it('records an event once: true for a new key, then false for the same key', async () => {
      const { store } = await loadWithFakeDb();

      expect(await store.recordEvent(EVENT)).toBe(true);
      expect(
        await store.recordEvent({ ...EVENT, id: '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b' })
      ).toBe(false);
    });

    it('inserts with ON CONFLICT on the idempotency key, parameterized', async () => {
      const { store, db } = await loadWithFakeDb();
      await store.recordEvent(EVENT);

      const insert = db.query.mock.calls.find(([sql]) =>
        String(sql).includes('INSERT INTO webhook_events')
      ) as [string, unknown[]];
      expect(insert[0]).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
      expect(insert[0]).toContain('RETURNING id');
      expect(insert[1]).toEqual([
        EVENT.id,
        EVENT.idempotencyKey,
        EVENT.kind,
        JSON.stringify(EVENT),
        EVENT.createdAt,
      ]);
    });

    it('round-trips the envelope through getEvent, and returns null for an unknown id', async () => {
      const { store } = await loadWithFakeDb();
      await store.recordEvent(EVENT);

      expect(await store.getEvent(EVENT.id)).toEqual(EVENT);
      expect(await store.getEvent('missing')).toBeNull();
    });
  });

  it('runs the schema SQL once across calls', async () => {
    const { store, db } = await loadWithFakeDb();

    await store.listSubscriptions();
    await store.getSubscription('sub-1');

    const ddl = db.query.mock.calls.filter(([sql]) => String(sql).includes('CREATE TABLE'));
    expect(ddl).toHaveLength(1);
  });
});

describe('getWebhookStore (#1337)', () => {
  it('picks the Postgres store when DATABASE_URL is set', async () => {
    await loadWithFakeDb();
    const { getWebhookStore } = await import('@/lib/webhooks/store');
    const { PostgresWebhookStore } = await import('@/lib/webhooks/postgres');

    expect(getWebhookStore()).toBeInstanceOf(PostgresWebhookStore);
  });

  it('stays in memory when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    const { getWebhookStore, InMemoryWebhookStore } = await import('@/lib/webhooks/store');

    expect(getWebhookStore()).toBeInstanceOf(InMemoryWebhookStore);
  });
});
