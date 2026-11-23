/**
 * lib/audit/store.ts
 *
 * In-memory and singleton factory for the audit log store (AGS013).
 */

import { hasDatabaseUrl } from '@/lib/reputation/pool';
import type { AuditEvent, AuditQuery, AuditStore } from './types';
import { PostgresAuditStore } from './postgres';

export { type AuditEvent, type AuditQuery, type AuditStore } from './types';

export class InMemoryAuditStore implements AuditStore {
  private readonly events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.events.push({ ...event });
  }

  async listRange(q: AuditQuery): Promise<AuditEvent[]> {
    const fromTime = Date.parse(q.from);
    const toTime = Date.parse(q.to);

    return this.events
      .filter((e) => {
        const atTime = Date.parse(e.at);
        if (atTime < fromTime || atTime >= toTime) return false;
        if (q.callerId && e.callerId !== q.callerId) return false;
        return true;
      })
      .sort((a, b) => {
        const diff = Date.parse(a.at) - Date.parse(b.at);
        if (diff !== 0) return diff;
        return a.id.localeCompare(b.id);
      })
      .slice(0, q.limit)
      .map((e) => ({ ...e }));
  }
}

let singleton: AuditStore | null = null;

export function getAuditStore(): AuditStore {
  if (!singleton) {
    singleton = hasDatabaseUrl() ? new PostgresAuditStore() : new InMemoryAuditStore();
  }
  return singleton;
}

export function _setAuditStore(store: AuditStore | null): void {
  singleton = store;
}
