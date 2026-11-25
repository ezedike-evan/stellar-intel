import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/webhooks/deliveries/[id]/redeliver/route';
import { GET as listDeliveries } from '@/app/api/webhooks/deliveries/route';
import { buildOpenApiSpec } from '@/lib/api/openapi';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { dispatchEvent } from '@/lib/webhooks/dispatch';
import { verifySignatureHeader } from '@/lib/webhooks/sign';
import { InMemoryWebhookStore, _setWebhookStore } from '@/lib/webhooks/store';
import type { DeliveryRecord, WebhookEvent, WebhookSubscription } from '@/lib/webhooks/types';

// #2185 (WHK007): an operator resends one logged delivery once the subscriber is back.

const ADMIN_KEY = 'test-admin-key';

const EVENT: WebhookEvent = {
  id: '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
  kind: 'intent.settled',
  createdAt: '2026-11-20T10:00:00.000Z',
  idempotencyKey: `intent.settled:${'a'.repeat(64)}`,
  payload: {
    intentHash: 'a'.repeat(64),
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    quotedAmount: '100',
    stellarTransactionId: 'b'.repeat(64),
  },
};

const SUB: WebhookSubscription = {
  id: 'sub-1',
  url: 'https://example.com/hook',
  secret: 'whsec_test',
  events: ['intent.settled', 'intent.failed'],
  createdAt: '2026-11-20T09:00:00.000Z',
};

function delivery(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    id: 'd-1',
    eventId: EVENT.id,
    eventKind: EVENT.kind,
    subscriptionId: SUB.id,
    url: SUB.url,
    status: 'dead_letter',
    attempts: 5,
    lastStatusCode: 503,
    lastError: 'HTTP 503',
    deliveredAt: null,
    createdAt: '2026-11-20T10:00:20.000Z',
    ...overrides,
  };
}

const ok = () => ({ ok: true, status: 200 });
const down = () => ({ ok: false, status: 503 });
const noSleep = () => Promise.resolve();

let store: InMemoryWebhookStore;
// The subscriber answers 200 at once unless a test says otherwise, so no backoff runs.
let fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ok());

beforeEach(() => {
  process.env.ADMIN_SECRET_KEY = ADMIN_KEY;
  store = new InMemoryWebhookStore();
  _setWebhookStore(store);
  clearRateLimitStore();
  fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ok());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  delete process.env.ADMIN_SECRET_KEY;
  _setWebhookStore(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A logged delivery of EVENT to SUB, with the event and the subscription still stored. */
async function seed(record: DeliveryRecord = delivery()): Promise<DeliveryRecord> {
  await store.recordEvent(EVENT);
  await store.saveSubscription(SUB);
  await store.recordDelivery(record);
  return record;
}

function redeliver(id: string, headers: Record<string, string> = { 'x-admin-key': ADMIN_KEY }) {
  const request = new NextRequest(`http://localhost/api/webhooks/deliveries/${id}/redeliver`, {
    method: 'POST',
    headers,
  });
  return POST(request, { params: Promise.resolve({ id }) });
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { code: string }).code;
}

describe('POST /api/webhooks/deliveries/[id]/redeliver (#2185)', () => {
  it('answers 202 and sends the stored envelope with its original id and idempotency key', async () => {
    await seed();

    const res = await redeliver('d-1');

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      redelivered: true,
      eventId: EVENT.id,
      subscriptionId: SUB.id,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(SUB.url);
    expect(init.method).toBe('POST');
    // The envelope as it was stored, not a rebuilt one.
    expect(init.body).toBe(JSON.stringify(EVENT));
    expect((JSON.parse(init.body as string) as WebhookEvent).id).toBe(EVENT.id);
    const headers = init.headers as Record<string, string>;
    expect(headers['x-webhook-id']).toBe(EVENT.id);
    expect(headers['x-webhook-idempotency-key']).toBe(EVENT.idempotencyKey);
  });

  it('signs the resent body with a current timestamp, so replay protection accepts it', async () => {
    await seed();

    await redeliver('d-1');

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    // verifySignatureHeader refuses a timestamp more than five minutes old; the event is days old.
    expect(
      verifySignatureHeader(SUB.secret, headers['x-webhook-signature']!, init.body as string)
    ).toBe(true);
    expect(Math.abs(Number(headers['x-webhook-timestamp']) - Date.now() / 1000)).toBeLessThan(60);
  });

  it('appends a new delivery record and leaves the original as it was', async () => {
    const original = await seed();

    await redeliver('d-1');

    const log = await store.listDeliveries({ eventId: EVENT.id });
    expect(log).toHaveLength(2);
    expect(await store.getDelivery('d-1')).toEqual(original);
    const added = log.find((r) => r.id !== 'd-1');
    expect(added).toMatchObject({
      eventId: EVENT.id,
      eventKind: EVENT.kind,
      subscriptionId: SUB.id,
      url: SUB.url,
      status: 'success',
      attempts: 1,
      lastStatusCode: 200,
      lastError: null,
    });
    expect(added?.deliveredAt).toEqual(expect.any(String));
    // The original is still the one dead letter.
    expect((await store.listDeadLetters()).map((r) => r.id)).toEqual(['d-1']);
  });

  it('resends an event the store has already dispatched, which dispatchEvent would drop', async () => {
    await store.saveSubscription(SUB);
    fetchMock.mockImplementation(async () => down());
    await dispatchEvent(EVENT, store, noSleep);
    const [dead] = await store.listDeadLetters();
    expect(dead?.attempts).toBe(5);

    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => ok());
    // The same event dispatched again goes nowhere: its idempotency key is known.
    await dispatchEvent(EVENT, store, noSleep);
    expect(fetchMock).not.toHaveBeenCalled();

    const res = await redeliver(dead!.id);

    expect(res.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const statuses = (await store.listDeliveries({ eventId: EVENT.id })).map((r) => r.status);
    expect(statuses.sort()).toEqual(['dead_letter', 'success']);
  });

  it("sends to the delivery's own subscription only, not to every subscriber of the kind", async () => {
    await seed();
    await store.saveSubscription({ ...SUB, id: 'sub-2', url: 'https://other.example.com/hook' });

    await redeliver('d-1');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([SUB.url]);
  });

  it('picks the delivery by its id when the log holds several', async () => {
    await seed();
    await store.saveSubscription({ ...SUB, id: 'sub-2', url: 'https://other.example.com/hook' });
    await store.recordDelivery(delivery({ id: 'd-2', subscriptionId: 'sub-2' }));

    const res = await redeliver('d-2');

    expect(await res.json()).toMatchObject({ subscriptionId: 'sub-2' });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://other.example.com/hook']);
  });

  it('resends a delivery that succeeded, too', async () => {
    await seed(
      delivery({
        status: 'success',
        attempts: 1,
        lastStatusCode: 200,
        lastError: null,
        deliveredAt: '2026-11-20T10:00:01.000Z',
      })
    );

    const res = await redeliver('d-1');

    expect(res.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends to the subscription's current URL, not the one in the old record", async () => {
    await seed(delivery({ url: 'https://old.example.com/hook' }));

    await redeliver('d-1');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([SUB.url]);
  });

  it('answers 202 when the subscriber is still down, and logs another dead letter', async () => {
    await seed();
    fetchMock.mockImplementation(async () => down());
    vi.useFakeTimers();

    const pending = redeliver('d-1');
    // 1 + 2 + 4 + 8 s of backoff between the five attempts.
    await vi.advanceTimersByTimeAsync(20_000);
    const res = await pending;

    expect(res.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const dead = await store.listDeadLetters();
    expect(dead).toHaveLength(2);
    expect(dead.find((r) => r.id !== 'd-1')).toMatchObject({
      status: 'dead_letter',
      attempts: 5,
      lastStatusCode: 503,
    });
  });

  it('does not answer until the delivery has been attempted', async () => {
    await seed();
    let release = (): void => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok());
        })
    );
    let answered = false;
    const pending = redeliver('d-1').then((res) => {
      answered = true;
      return res;
    });

    // Long enough for the route to reach the subscriber, which has not replied yet.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(answered).toBe(false);

    release();
    expect((await pending).status).toBe(202);
    expect(await store.listDeliveries({})).toHaveLength(2);
  });

  it('answers 403 without the admin key and sends nothing', async () => {
    await seed();

    const res = await redeliver('d-1', {});

    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('FORBIDDEN');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await store.listDeliveries({})).toHaveLength(1);
  });

  it('answers 403 for a wrong admin key', async () => {
    await seed();

    const res = await redeliver('d-1', { 'x-admin-key': 'not-the-key' });

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 404 for a delivery id the log does not have', async () => {
    await seed();

    const res = await redeliver('d-404');

    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('NOT_FOUND');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 410 EVENT_NOT_RETAINED when the event is not stored', async () => {
    await store.saveSubscription(SUB);
    await store.recordDelivery(delivery());

    const res = await redeliver('d-1');

    expect(res.status).toBe(410);
    expect(await errorCode(res)).toBe('EVENT_NOT_RETAINED');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await store.listDeliveries({})).toHaveLength(1);
  });

  it('answers 410 SUBSCRIPTION_DELETED when the subscription is gone', async () => {
    await seed();
    await store.deleteSubscription(SUB.id);

    const res = await redeliver('d-1');

    expect(res.status).toBe(410);
    expect(await errorCode(res)).toBe('SUBSCRIPTION_DELETED');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await store.listDeliveries({})).toHaveLength(1);
  });

  it('reports the missing event first when the subscription is gone as well', async () => {
    await store.recordDelivery(delivery());

    const res = await redeliver('d-1');

    expect(res.status).toBe(410);
    expect(await errorCode(res)).toBe('EVENT_NOT_RETAINED');
  });

  it('answers 409 EVENT_KIND_UNSUBSCRIBED when the subscription dropped the kind', async () => {
    await seed();
    await store.saveSubscription({ ...SUB, events: ['intent.failed'] });

    const res = await redeliver('d-1');

    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('EVENT_KIND_UNSUBSCRIBED');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await store.listDeliveries({})).toHaveLength(1);
  });

  it('rate limits before the admin check: ten requests pass, the eleventh is a 429', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await redeliver('d-1', {})).status).toBe(403);
    }

    const res = await redeliver('d-1', {});

    expect(res.status).toBe(429);
    expect(await errorCode(res)).toBe('RATE_LIMITED');
  });

  it('has its own allowance: listing deliveries ten times does not use it up', async () => {
    await seed();
    for (let i = 0; i < 10; i++) {
      const list = new NextRequest('http://localhost/api/webhooks/deliveries', {
        headers: { 'x-admin-key': ADMIN_KEY },
      });
      expect((await listDeliveries(list)).status).toBe(200);
    }

    expect((await redeliver('d-1')).status).toBe(202);
  });
});

describe('InMemoryWebhookStore.getDelivery (#2185)', () => {
  it('returns the record with that id, and null when there is none', async () => {
    const first = delivery({ id: 'd-1' });
    const second = delivery({ id: 'd-2', status: 'failed', attempts: 2 });
    await store.recordDelivery(first);
    await store.recordDelivery(second);

    expect(await store.getDelivery('d-2')).toEqual(second);
    expect(await store.getDelivery('d-1')).toEqual(first);
    expect(await store.getDelivery('d-3')).toBeNull();
  });

  it('returns a copy, so a caller cannot edit the log', async () => {
    await store.recordDelivery(delivery());

    const found = await store.getDelivery('d-1');
    found!.status = 'success';

    expect((await store.getDelivery('d-1'))?.status).toBe('dead_letter');
  });
});

describe('OpenAPI entry for the redelivery endpoint (#2185)', () => {
  it('is an admin operation with the id path parameter and every status the route returns', () => {
    const spec = buildOpenApiSpec();
    const op = spec.paths?.['/api/webhooks/deliveries/{id}/redeliver']?.post;

    expect(op).toBeDefined();
    expect(op?.security).toEqual([{ adminKey: [] }]);
    expect(op?.parameters).toEqual([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    ]);
    expect(Object.keys(op?.responses ?? {}).sort()).toEqual([
      '202',
      '403',
      '404',
      '409',
      '410',
      '429',
    ]);
  });
});
