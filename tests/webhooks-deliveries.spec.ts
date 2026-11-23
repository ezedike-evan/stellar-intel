import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/webhooks/deliveries/route';
import { InMemoryWebhookStore, _setWebhookStore } from '@/lib/webhooks/store';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import type { DeliveryRecord } from '@/lib/webhooks/types';

const ADMIN_KEY = 'test-admin-key';

beforeEach(() => {
  process.env.ADMIN_SECRET_KEY = ADMIN_KEY;
  _setWebhookStore(new InMemoryWebhookStore());
  clearRateLimitStore();
});

afterEach(() => {
  delete process.env.ADMIN_SECRET_KEY;
  _setWebhookStore(null);
});

function getReq(query = '') {
  const url = `http://localhost/api/webhooks/deliveries${query ? `?${query}` : ''}`;
  return new NextRequest(url, {
    method: 'GET',
    headers: { 'x-admin-key': ADMIN_KEY },
  });
}

function delivery(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    id: 'd-1',
    eventId: 'evt-1',
    eventKind: 'intent.settled',
    subscriptionId: 'sub-1',
    url: 'https://example.com/hook',
    status: 'success',
    attempts: 1,
    lastStatusCode: 200,
    lastError: null,
    deliveredAt: '2026-09-26T10:00:01.000Z',
    createdAt: '2026-09-26T10:00:00.000Z',
    ...overrides,
  };
}

describe('GET /api/webhooks/deliveries', () => {
  it('returns 403 without admin key', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/deliveries', {
      method: 'GET',
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('FORBIDDEN');
  });

  it('narrows results with each filter', async () => {
    const { getWebhookStore } = await import('@/lib/webhooks/store');
    const store = getWebhookStore();

    const d1 = delivery({ id: 'd1', status: 'success', subscriptionId: 'sub-1', eventId: 'evt-1' });
    const d2 = delivery({ id: 'd2', status: 'failed', subscriptionId: 'sub-1', eventId: 'evt-2' });
    const d3 = delivery({
      id: 'd3',
      status: 'dead_letter',
      subscriptionId: 'sub-2',
      eventId: 'evt-1',
    });
    const d4 = delivery({ id: 'd4', status: 'success', subscriptionId: 'sub-2', eventId: 'evt-2' });

    await store.recordDelivery(d1);
    await store.recordDelivery(d2);
    await store.recordDelivery(d3);
    await store.recordDelivery(d4);

    // Filter by status
    const statusRes = await GET(getReq('status=failed'));
    expect(statusRes.status).toBe(200);
    const statusList = (await statusRes.json()) as DeliveryRecord[];
    expect(statusList.map((d) => d.id)).toEqual(['d2']);

    // Filter by subscriptionId
    const subRes = await GET(getReq('subscriptionId=sub-2'));
    expect(subRes.status).toBe(200);
    const subList = (await subRes.json()) as DeliveryRecord[];
    expect(subList.map((d) => d.id).sort()).toEqual(['d3', 'd4']);

    // Filter by eventId
    const evtRes = await GET(getReq('eventId=evt-1'));
    expect(evtRes.status).toBe(200);
    const evtList = (await evtRes.json()) as DeliveryRecord[];
    expect(evtList.map((d) => d.id).sort()).toEqual(['d1', 'd3']);

    // Combined filters
    const comboRes = await GET(getReq('status=success&subscriptionId=sub-1&eventId=evt-1'));
    expect(comboRes.status).toBe(200);
    const comboList = (await comboRes.json()) as DeliveryRecord[];
    expect(comboList.map((d) => d.id)).toEqual(['d1']);
  });

  it('honours limit', async () => {
    const { getWebhookStore } = await import('@/lib/webhooks/store');
    const store = getWebhookStore();

    for (let i = 1; i <= 5; i++) {
      await store.recordDelivery(
        delivery({
          id: `d-${i}`,
          createdAt: `2026-09-26T10:0${i}:00.000Z`,
        })
      );
    }

    const res = await GET(getReq('limit=3'));
    expect(res.status).toBe(200);
    const list = (await res.json()) as DeliveryRecord[];
    expect(list).toHaveLength(3);
  });

  it('returns deliveries newest first', async () => {
    const { getWebhookStore } = await import('@/lib/webhooks/store');
    const store = getWebhookStore();

    await store.recordDelivery(delivery({ id: 'old', createdAt: '2026-09-26T08:00:00.000Z' }));
    await store.recordDelivery(delivery({ id: 'newest', createdAt: '2026-09-26T12:00:00.000Z' }));
    await store.recordDelivery(delivery({ id: 'middle', createdAt: '2026-09-26T10:00:00.000Z' }));

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const list = (await res.json()) as DeliveryRecord[];
    expect(list.map((d) => d.id)).toEqual(['newest', 'middle', 'old']);
  });

  it('returns 400 when status=bogus', async () => {
    const res = await GET(getReq('status=bogus'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for out-of-range limit', async () => {
    const resZero = await GET(getReq('limit=0'));
    expect(resZero.status).toBe(400);
    const bodyZero = (await resZero.json()) as { code: string; message: string };
    expect(bodyZero.code).toBe('VALIDATION_ERROR');

    const resOver = await GET(getReq('limit=501'));
    expect(resOver.status).toBe(400);
    const bodyOver = (await resOver.json()) as { code: string; message: string };
    expect(bodyOver.code).toBe('VALIDATION_ERROR');

    const resFloat = await GET(getReq('limit=2.5'));
    expect(resFloat.status).toBe(400);
  });

  it('returns 400 for oversized identifiers', async () => {
    const longId = 'a'.repeat(101);
    const resSub = await GET(getReq(`subscriptionId=${longId}`));
    expect(resSub.status).toBe(400);
    const bodySub = (await resSub.json()) as { code: string; message: string };
    expect(bodySub.code).toBe('VALIDATION_ERROR');

    const resEvt = await GET(getReq(`eventId=${longId}`));
    expect(resEvt.status).toBe(400);
    const bodyEvt = (await resEvt.json()) as { code: string; message: string };
    expect(bodyEvt.code).toBe('VALIDATION_ERROR');
  });
});
