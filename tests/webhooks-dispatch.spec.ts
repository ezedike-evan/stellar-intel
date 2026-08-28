import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryWebhookStore } from '@/lib/webhooks/store';
import { deliverToSubscription, dispatchEvent } from '@/lib/webhooks/dispatch';
import { makeWebhookEvent } from '@/lib/webhooks/events';
import type { WebhookSubscription } from '@/lib/webhooks/types';

const noopSleep = () => Promise.resolve();

const SUB: WebhookSubscription = {
  id: 'sub-1',
  url: 'https://example.com/webhook',
  secret: 'test-secret',
  events: ['intent.created', 'intent.settled'],
  createdAt: new Date().toISOString(),
};

let store: InMemoryWebhookStore;

beforeEach(() => {
  store = new InMemoryWebhookStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deliverToSubscription — success path', () => {
  it('records a success entry when the endpoint responds 2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200 }));

    const event = makeWebhookEvent('intent.created', { intentId: 'i-1' });
    await deliverToSubscription(SUB, event, store, noopSleep);

    const letters = await store.listDeadLetters();
    expect(letters).toHaveLength(0);
  });

  it('sends the correct headers including x-webhook-signature', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const event = makeWebhookEvent('intent.created', {});
    await deliverToSubscription(SUB, event, store, noopSleep);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['x-webhook-signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(headers['x-webhook-timestamp']).toMatch(/^\d+$/);
  });

  it('posts to the subscription url', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const event = makeWebhookEvent('intent.created', {});
    await deliverToSubscription(SUB, event, store, noopSleep);

    expect(mockFetch.mock.calls[0]?.[0]).toBe(SUB.url);
  });
});

describe('deliverToSubscription — retry and dead-letter', () => {
  it('retries up to 5 times on non-2xx responses before dead-lettering', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const event = makeWebhookEvent('intent.failed', { reason: 'timeout' });
    await deliverToSubscription(SUB, event, store, noopSleep);

    const letters = await store.listDeadLetters();
    expect(letters).toHaveLength(1);
    expect(letters[0]?.attempts).toBe(5);
    expect(letters[0]?.status).toBe('dead_letter');
  });

  it('succeeds on the third attempt without dead-lettering', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 502 })
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: true, status: 200 })
    );

    const event = makeWebhookEvent('intent.settled', { intentId: 'i-2' });
    await deliverToSubscription(SUB, event, store, noopSleep);

    const letters = await store.listDeadLetters();
    expect(letters).toHaveLength(0);
  });

  it('records the last status code on dead-letter', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));

    const event = makeWebhookEvent('intent.failed', {});
    await deliverToSubscription(SUB, event, store, noopSleep);

    const letters = await store.listDeadLetters();
    expect(letters[0]?.lastStatusCode).toBe(429);
  });

  it('dead-letters after network errors with attempt count preserved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const event = makeWebhookEvent('intent.created', {});
    await deliverToSubscription(SUB, event, store, noopSleep);

    const letters = await store.listDeadLetters();
    expect(letters[0]?.attempts).toBe(5);
    expect(letters[0]?.lastError).toContain('ECONNREFUSED');
  });

  it('calls sleepFn between retries with exponential intervals', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const sleepCalls: number[] = [];
    const captureSleep = (ms: number) => {
      sleepCalls.push(ms);
      return Promise.resolve();
    };

    const event = makeWebhookEvent('intent.created', {});
    await deliverToSubscription(SUB, event, store, captureSleep);

    // 5 attempts = 4 sleeps between them
    expect(sleepCalls).toHaveLength(4);
    expect(sleepCalls[0]).toBe(1_000);
    expect(sleepCalls[1]).toBe(2_000);
    expect(sleepCalls[2]).toBe(4_000);
    expect(sleepCalls[3]).toBe(8_000);
  });
});

describe('dispatchEvent — fan-out', () => {
  it('delivers to matching subscriptions only', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    await store.saveSubscription(SUB);
    await store.saveSubscription({
      ...SUB,
      id: 'sub-2',
      events: ['anchor.health_status_changed'],
    });

    const event = makeWebhookEvent('intent.created', {});
    await dispatchEvent(event, store, noopSleep);

    // Only SUB (sub-1) subscribes to intent.created
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not call fetch when no subscriptions match the event kind', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    await store.saveSubscription({ ...SUB, events: ['anchor.health_status_changed'] });

    const event = makeWebhookEvent('intent.created', {});
    await dispatchEvent(event, store, noopSleep);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('continues delivering to other subscribers even when one dead-letters', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true, status: 200 })
    );

    const sub2: WebhookSubscription = { ...SUB, id: 'sub-2', url: 'https://other.example.com/wh' };
    await store.saveSubscription(SUB);
    await store.saveSubscription(sub2);

    const event = makeWebhookEvent('intent.created', {});
    await dispatchEvent(event, store, noopSleep);

    const letters = await store.listDeadLetters();
    expect(letters).toHaveLength(1);
    expect(letters[0]?.subscriptionId).toBe('sub-1');
  });
});
