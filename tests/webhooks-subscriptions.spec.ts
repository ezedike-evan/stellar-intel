import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from '@/app/api/webhooks/subscriptions/route';
import { DELETE } from '@/app/api/webhooks/subscriptions/[id]/route';
import { GET as getFailures } from '@/app/api/webhooks/failures/route';
import { InMemoryWebhookStore, _setWebhookStore } from '@/lib/webhooks/store';
import type { DeliveryRecord } from '@/lib/webhooks/types';

const ADMIN_KEY = 'test-admin-key';

beforeEach(() => {
  process.env.ADMIN_SECRET_KEY = ADMIN_KEY;
  _setWebhookStore(new InMemoryWebhookStore());
});

afterEach(() => {
  delete process.env.ADMIN_SECRET_KEY;
  _setWebhookStore(null);
});

function adminHeaders() {
  return { 'content-type': 'application/json', 'x-admin-key': ADMIN_KEY };
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/webhooks/subscriptions', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
}

function getReq(path = '/api/webhooks/subscriptions') {
  return new NextRequest(`http://localhost${path}`, {
    method: 'GET',
    headers: { 'x-admin-key': ADMIN_KEY },
  });
}

function deleteReq(id: string) {
  return new NextRequest(`http://localhost/api/webhooks/subscriptions/${id}`, {
    method: 'DELETE',
    headers: { 'x-admin-key': ADMIN_KEY },
  });
}

// ─── POST /api/webhooks/subscriptions ─────────────────────────────────────────

describe('POST /api/webhooks/subscriptions', () => {
  it('creates a subscription and returns 201 with a secret', async () => {
    const res = await POST(
      postReq({ url: 'https://example.com/hook', events: ['intent.created'] })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('secret');
    expect(typeof body['secret']).toBe('string');
    expect((body['secret'] as string).length).toBeGreaterThan(0);
  });

  it('returns 403 without admin key', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['intent.created'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 for an invalid URL', async () => {
    const res = await POST(postReq({ url: 'not-a-url', events: ['intent.created'] }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when events array is empty', async () => {
    const res = await POST(postReq({ url: 'https://example.com/hook', events: [] }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unknown event kind', async () => {
    const res = await POST(postReq({ url: 'https://example.com/hook', events: ['unknown.event'] }));
    expect(res.status).toBe(400);
  });

  it('accepts multiple event kinds', async () => {
    const res = await POST(
      postReq({
        url: 'https://example.com/hook',
        events: ['intent.created', 'intent.settled', 'anchor.health_status_changed'],
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { events: string[] };
    expect(body.events).toHaveLength(3);
  });
});

// ─── GET /api/webhooks/subscriptions ──────────────────────────────────────────

describe('GET /api/webhooks/subscriptions', () => {
  it('returns an empty array when no subscriptions exist', async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('lists created subscriptions without exposing secrets', async () => {
    await POST(postReq({ url: 'https://a.example.com/hook', events: ['intent.created'] }));
    await POST(postReq({ url: 'https://b.example.com/hook', events: ['intent.settled'] }));

    const res = await GET(getReq());
    const list = (await res.json()) as Record<string, unknown>[];
    expect(list).toHaveLength(2);
    for (const item of list) {
      expect(item).not.toHaveProperty('secret');
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('url');
    }
  });

  it('returns 403 without admin key', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/subscriptions', {
      method: 'GET',
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });
});

// ─── DELETE /api/webhooks/subscriptions/[id] ──────────────────────────────────

describe('DELETE /api/webhooks/subscriptions/[id]', () => {
  it('deletes an existing subscription and returns 204', async () => {
    const createRes = await POST(
      postReq({ url: 'https://example.com/hook', events: ['intent.created'] })
    );
    const { id } = (await createRes.json()) as { id: string };

    const delRes = await DELETE(deleteReq(id), { params: Promise.resolve({ id }) });
    expect(delRes.status).toBe(204);

    const listRes = await GET(getReq());
    expect(await listRes.json()).toEqual([]);
  });

  it('returns 404 when deleting a non-existent subscription', async () => {
    const res = await DELETE(deleteReq('ghost-id'), {
      params: Promise.resolve({ id: 'ghost-id' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 403 without admin key', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/subscriptions/x', {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'x' }) });
    expect(res.status).toBe(403);
  });
});

// ─── GET /api/webhooks/failures ───────────────────────────────────────────────

describe('GET /api/webhooks/failures', () => {
  it('returns an empty array when no dead-letters exist', async () => {
    const res = await getFailures(getReq('/api/webhooks/failures'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns dead-letter records recorded in the store', async () => {
    const { getWebhookStore } = await import('@/lib/webhooks/store');
    const s = getWebhookStore();
    const record: DeliveryRecord = {
      id: 'dl-1',
      eventId: 'evt-1',
      eventKind: 'intent.failed',
      subscriptionId: 'sub-1',
      url: 'https://example.com/hook',
      status: 'dead_letter',
      attempts: 5,
      lastStatusCode: 500,
      lastError: 'HTTP 500',
      deliveredAt: null,
      createdAt: new Date().toISOString(),
    };
    await s.recordDelivery(record);

    const res = await getFailures(getReq('/api/webhooks/failures'));
    const list = (await res.json()) as DeliveryRecord[];
    expect(list).toHaveLength(1);
    expect(list[0]?.eventKind).toBe('intent.failed');
    expect(list[0]?.status).toBe('dead_letter');
  });

  it('returns 403 without admin key', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/failures', {
      method: 'GET',
    });
    const res = await getFailures(req);
    expect(res.status).toBe(403);
  });
});
