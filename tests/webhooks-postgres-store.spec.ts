import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryRecord, WebhookSubscription } from '@/lib/webhooks/types';

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

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('CREATE TABLE')) return { rows: [] };

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
      // Mirrors `WHERE status = 'dead_letter' ORDER BY created_at DESC`.
      const rows = deliveries
        .filter((d) => d['status'] === 'dead_letter')
        .sort((a, b) => (b['created_at'] as Date).getTime() - (a['created_at'] as Date).getTime());
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
