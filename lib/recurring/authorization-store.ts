import {
  type StoredStandingAuthorization,
  type SignedStandingAuthorization,
  type ExecutionRecord,
  type StandingAuthorizationStatus,
} from '@/types/recurring';

export interface StandingAuthorizationStore {
  save(signed: SignedStandingAuthorization): Promise<StoredStandingAuthorization>;
  get(id: string): Promise<StoredStandingAuthorization | null>;
  list(filter?: { sender?: string; status?: StandingAuthorizationStatus }): Promise<StoredStandingAuthorization[]>;
  updateStatus(
    id: string,
    status: StandingAuthorizationStatus,
    metadata?: { pausedAt?: string; cancelledAt?: string }
  ): Promise<StoredStandingAuthorization | null>;
  recordExecution(id: string, execution: ExecutionRecord): Promise<StoredStandingAuthorization | null>;
  clear(): Promise<void>;
}

export class InMemoryStandingAuthorizationStore implements StandingAuthorizationStore {
  private records = new Map<string, StoredStandingAuthorization>();

  async save(signed: SignedStandingAuthorization): Promise<StoredStandingAuthorization> {
    const existing = this.records.get(signed.termsHash);
    if (existing) {
      return existing;
    }
    const stored: StoredStandingAuthorization = {
      terms: signed.terms,
      termsHash: signed.termsHash,
      signature: signed.signature,
      publicKey: signed.publicKey,
      createdAt: new Date().toISOString(),
      status: 'active',
      executions: [],
    };
    this.records.set(signed.termsHash, stored);
    return stored;
  }

  async get(id: string): Promise<StoredStandingAuthorization | null> {
    return this.records.get(id) ?? null;
  }

  async list(filter?: {
    sender?: string;
    status?: StandingAuthorizationStatus;
  }): Promise<StoredStandingAuthorization[]> {
    let all = Array.from(this.records.values());
    if (filter?.sender) {
      all = all.filter((r) => r.terms.sender === filter.sender);
    }
    if (filter?.status) {
      all = all.filter((r) => r.status === filter.status);
    }
    return all;
  }

  async updateStatus(
    id: string,
    status: StandingAuthorizationStatus,
    metadata?: { pausedAt?: string; cancelledAt?: string }
  ): Promise<StoredStandingAuthorization | null> {
    const item = this.records.get(id);
    if (!item) return null;
    item.status = status;
    if (metadata?.pausedAt !== undefined) item.pausedAt = metadata.pausedAt;
    if (metadata?.cancelledAt !== undefined) item.cancelledAt = metadata.cancelledAt;
    this.records.set(id, item);
    return item;
  }

  async recordExecution(
    id: string,
    execution: ExecutionRecord
  ): Promise<StoredStandingAuthorization | null> {
    const item = this.records.get(id);
    if (!item) return null;
    const exists = item.executions.some((e) => e.intentHash === execution.intentHash);
    if (!exists) {
      item.executions.push(execution);
      this.records.set(id, item);
    }
    return item;
  }

  async clear(): Promise<void> {
    this.records.clear();
  }
}

let storeInstance: StandingAuthorizationStore | null = null;

export function getStore(reset?: boolean): StandingAuthorizationStore {
  if (reset || !storeInstance) {
    storeInstance = new InMemoryStandingAuthorizationStore();
  }
  return storeInstance;
}

export function resetStandingAuthorizationStore(): void {
  storeInstance = new InMemoryStandingAuthorizationStore();
}
