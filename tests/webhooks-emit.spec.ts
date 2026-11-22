import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryWebhookStore, _setWebhookStore } from '@/lib/webhooks/store';
import { emitWebhookEvent, _setWebhookEmitter } from '@/lib/webhooks/emit';
import type { WebhookSubscription } from '@/lib/webhooks/types';

const SUB: WebhookSubscription = {
  id: 'sub-1',
  url: 'https://example.com/webhook',
  secret: 'test-secret',
  events: ['intent.created'],
  createdAt: new Date().toISOString(),
};

const SAMPLE_CREATED = {
  intentHash: 'a'.repeat(64),
  direction: 'offramp' as const,
  corridorId: 'usdc-ngn',
  anchorId: 'cowrie',
  quoteId: 'quote-1',
  amount: '100',
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
};

const SAMPLE_SETTLED = {
  intentHash: 'a'.repeat(64),
  anchorId: 'cowrie',
  corridor: 'usdc-ngn',
  quotedAmount: '100',
  stellarTransactionId: 'b'.repeat(64),
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

describe('emitWebhookEvent', () => {
  it('eventually records one success delivery for a matching subscription', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    await store.saveSubscription(SUB);

    emitWebhookEvent('intent.created', SAMPLE_CREATED);
    await flush();

    const letters = await store.listDeadLetters();
    expect(letters).toHaveLength(0);
  });

  it('does not throw when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await store.saveSubscription(SUB);

    expect(() => emitWebhookEvent('intent.created', SAMPLE_CREATED)).not.toThrow();
    await flush();
  });

  it('does not throw outside a request scope', () => {
    expect(() => emitWebhookEvent('intent.created', SAMPLE_CREATED)).not.toThrow();
  });

  it('delivers the seam a (kind, payload) pair instead of dispatching', async () => {
    const seen: Array<[string, Record<string, unknown>]> = [];
    _setWebhookEmitter((kind, payload) => {
      seen.push([kind, payload]);
    });
    vi.stubGlobal('fetch', vi.fn());

    emitWebhookEvent('intent.settled', SAMPLE_SETTLED);

    expect(seen).toEqual([['intent.settled', SAMPLE_SETTLED]]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
