import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryWebhookStore, _setWebhookStore } from '@/lib/webhooks/store';
import { emitWebhookEvent, _setWebhookEmitter } from '@/lib/webhooks/emit';
import { makeWebhookEvent } from '@/lib/webhooks/events';
import type { WebhookSubscription } from '@/lib/webhooks/types';

const SUB: WebhookSubscription = {
  id: 'sub-1',
  url: 'https://example.com/webhook',
  secret: 'test-secret',
  events: ['intent.created'],
  createdAt: new Date().toISOString(),
};

let store: InMemoryWebhookStore;

// Delivery runs on a detached promise chain; flush the microtask/macrotask
// queue a few times so it settles before we assert on the store.
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  store = new InMemoryWebhookStore();
  _setWebhookStore(store);
  _setWebhookEmitter(null);
});

afterEach(() => {
  _setWebhookStore(null);
  _setWebhookEmitter(null);
  vi.restoreAllMocks();
});

const CREATED_PAYLOAD = {
  intentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  direction: 'offramp' as const,
  corridorId: 'usdc-ngn',
  anchorId: 'cowrie',
  quoteId: 'q-1',
  amount: '100',
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
};

const SETTLED_PAYLOAD = {
  intentHash: 'a'.repeat(64),
  anchorId: 'cowrie',
  corridor: 'usdc-ngn',
  quotedAmount: '100',
  stellarTransactionId: 'b'.repeat(64),
};

describe('emitWebhookEvent', () => {
  it('eventually records one success delivery for a matching subscription', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    await store.saveSubscription(SUB);

    emitWebhookEvent('intent.created', CREATED_PAYLOAD);
    await flush();

    const letters = await store.listDeadLetters();
    expect(letters).toHaveLength(0);
  });

  it('does not throw when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await store.saveSubscription(SUB);

    expect(() => emitWebhookEvent('intent.created', CREATED_PAYLOAD)).not.toThrow();
    await flush();
  });

  it('does not throw outside a request scope', () => {
    expect(() => emitWebhookEvent('intent.created', CREATED_PAYLOAD)).not.toThrow();
  });

  it('delivers the seam a (kind, payload) pair instead of dispatching', async () => {
    const seen: Array<[string, Record<string, unknown>]> = [];
    _setWebhookEmitter((kind, payload) => {
      seen.push([kind, payload]);
    });
    vi.stubGlobal('fetch', vi.fn());

    emitWebhookEvent('intent.settled', SETTLED_PAYLOAD);

    expect(seen).toEqual([['intent.settled', SETTLED_PAYLOAD]]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes an explicit idempotency key through to the seam and to the stored event (WHK004)', async () => {
    const seen: unknown[] = [];
    _setWebhookEmitter((_kind, _payload, opts) => {
      seen.push(opts);
    });
    emitWebhookEvent('intent.settled', SETTLED_PAYLOAD, { idempotencyKey: 'settle:tx-1' });
    expect(seen).toEqual([{ idempotencyKey: 'settle:tx-1' }]);

    _setWebhookEmitter(null);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    await store.saveSubscription({ ...SUB, events: ['intent.settled'] });
    emitWebhookEvent('intent.settled', SETTLED_PAYLOAD, { idempotencyKey: 'settle:tx-1' });
    await flush();
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-webhook-idempotency-key']).toBe('settle:tx-1');
  });

  it('defaults the idempotency key to <kind>:<event id>', () => {
    const event = makeWebhookEvent('intent.created', CREATED_PAYLOAD);
    expect(event.idempotencyKey).toBe(`intent.created:${event.id}`);
    expect(event.idempotencyKey).toMatch(
      /^intent\.created:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});
