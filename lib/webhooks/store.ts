import type { WebhookSubscription, DeliveryRecord } from './types';

export interface WebhookStore {
  saveSubscription(sub: WebhookSubscription): Promise<void>;
  listSubscriptions(): Promise<WebhookSubscription[]>;
  getSubscription(id: string): Promise<WebhookSubscription | null>;
  deleteSubscription(id: string): Promise<boolean>;
  recordDelivery(record: DeliveryRecord): Promise<void>;
  listDeadLetters(): Promise<DeliveryRecord[]>;
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
}

// ─── Process-wide singleton ────────────────────────────────────────────────────

let singleton: WebhookStore | null = null;

export function getWebhookStore(): WebhookStore {
  if (!singleton) singleton = new InMemoryWebhookStore();
  return singleton;
}

export function _setWebhookStore(store: WebhookStore | null): void {
  singleton = store;
}
