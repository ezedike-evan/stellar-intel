import { hasDatabaseUrl } from '@/lib/reputation/pool';
import { PostgresWebhookStore } from './postgres';
import type { WebhookSubscription, DeliveryRecord, DeliveryStatus } from './types';

export interface DeliveryQuery {
  status?: DeliveryStatus | undefined;
  subscriptionId?: string | undefined;
  eventId?: string | undefined;
  limit?: number | undefined;
}

export interface WebhookStore {
  saveSubscription(sub: WebhookSubscription): Promise<void>;
  listSubscriptions(): Promise<WebhookSubscription[]>;
  getSubscription(id: string): Promise<WebhookSubscription | null>;
  deleteSubscription(id: string): Promise<boolean>;
  recordDelivery(record: DeliveryRecord): Promise<void>;
  listDeadLetters(): Promise<DeliveryRecord[]>;
  listDeliveries(query: DeliveryQuery): Promise<DeliveryRecord[]>;
}

export class InMemoryWebhookStore implements WebhookStore {
  private readonly subs = new Map<string, WebhookSubscription>();
  private readonly deliveries: DeliveryRecord[] = [];

  async saveSubscription(sub: WebhookSubscription): Promise<void> {
    this.subs.set(sub.id, { ...sub });
  }

  async listSubscriptions(): Promise<WebhookSubscription[]> {
    return [...this.subs.values()].map((s) => ({ ...s }));
  }

  async getSubscription(id: string): Promise<WebhookSubscription | null> {
    return this.subs.get(id) ?? null;
  }

  async deleteSubscription(id: string): Promise<boolean> {
    return this.subs.delete(id);
  }

  async recordDelivery(record: DeliveryRecord): Promise<void> {
    this.deliveries.push({ ...record });
  }

  async listDeadLetters(): Promise<DeliveryRecord[]> {
    return this.deliveries.filter((r) => r.status === 'dead_letter').map((r) => ({ ...r }));
  }

  async listDeliveries(query: DeliveryQuery): Promise<DeliveryRecord[]> {
    const rawLimit = query.limit ?? 100;
    const limit = Math.max(1, Math.min(500, rawLimit));

    let results = this.deliveries.slice();
    if (query.status !== undefined) {
      results = results.filter((r) => r.status === query.status);
    }
    if (query.subscriptionId !== undefined) {
      results = results.filter((r) => r.subscriptionId === query.subscriptionId);
    }
    if (query.eventId !== undefined) {
      results = results.filter((r) => r.eventId === query.eventId);
    }
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return results.slice(0, limit).map((r) => ({ ...r }));
  }
}

// ─── Process-wide singleton ────────────────────────────────────────────────────

let singleton: WebhookStore | null = null;

/**
 * Postgres when a database is configured, so subscriptions survive cold starts
 * and are shared across instances. In-memory otherwise (local dev, tests).
 */
export function getWebhookStore(): WebhookStore {
  if (!singleton) {
    singleton = hasDatabaseUrl() ? new PostgresWebhookStore() : new InMemoryWebhookStore();
  }
  return singleton;
}

export function _setWebhookStore(store: WebhookStore | null): void {
  singleton = store;
}
