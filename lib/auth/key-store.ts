import { hasDatabaseUrl } from '@/lib/reputation/pool';
import type { ApiScope } from './api-keys';
import { PostgresApiKeyStore } from './key-store-postgres';

// ─── Caller API-key store (AGS002) ─────────────────────────────────────────────
//
// Only the hash of a key is ever stored. Same pattern as lib/webhooks/store.ts.

export type CallerTier = 'standard' | 'partner';

export interface ApiKeyRecord {
  keyId: string; // 16 lowercase hex, from AGS001
  displayPrefix: string; // `sik_${keyId}`
  hash: string; // hashApiKey(key), never the key itself
  name: string; // human label, 1-80 chars
  scopes: ApiScope[];
  tier: CallerTier;
  /** Per-call cap on the source amount of intents this key can create via MCP (AGS019). null = no per-key cap. */
  maxIntentAmount: string | null;
  createdAt: string; // ISO
  expiresAt: string | null; // ISO
  revokedAt: string | null; // ISO
  lastUsedAt: string | null; // ISO
}

export interface ApiKeyStore {
  /** Throws Error('api key already exists') on a duplicate keyId. */
  create(record: ApiKeyRecord): Promise<void>;
  get(keyId: string): Promise<ApiKeyRecord | null>;
  /** Newest createdAt first. */
  list(): Promise<ApiKeyRecord[]>;
  /** False when the key is unknown or already revoked. */
  revoke(keyId: string, at: string): Promise<boolean>;
  /** Sets lastUsedAt; no-op for an unknown keyId. */
  touch(keyId: string, at: string): Promise<void>;
}

function copy(record: ApiKeyRecord): ApiKeyRecord {
  return { ...record, scopes: [...record.scopes] };
}

export class InMemoryApiKeyStore implements ApiKeyStore {
  private readonly keys = new Map<string, ApiKeyRecord>();

  async create(record: ApiKeyRecord): Promise<void> {
    if (this.keys.has(record.keyId)) throw new Error('api key already exists');
    this.keys.set(record.keyId, copy(record));
  }

  async get(keyId: string): Promise<ApiKeyRecord | null> {
    const record = this.keys.get(keyId);
    return record ? copy(record) : null;
  }

  async list(): Promise<ApiKeyRecord[]> {
    return [...this.keys.values()]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map(copy);
  }

  async revoke(keyId: string, at: string): Promise<boolean> {
    const record = this.keys.get(keyId);
    if (!record || record.revokedAt) return false;
    record.revokedAt = at;
    return true;
  }

  async touch(keyId: string, at: string): Promise<void> {
    const record = this.keys.get(keyId);
    if (record) record.lastUsedAt = at;
  }
}

// ─── Process-wide singleton ────────────────────────────────────────────────────

let singleton: ApiKeyStore | null = null;

/** Postgres when a database is configured, in-memory otherwise (local dev, tests). */
export function getApiKeyStore(): ApiKeyStore {
  if (!singleton) {
    singleton = hasDatabaseUrl() ? new PostgresApiKeyStore() : new InMemoryApiKeyStore();
  }
  return singleton;
}

export function _setApiKeyStore(store: ApiKeyStore | null): void {
  singleton = store;
}
