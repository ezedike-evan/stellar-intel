import { getLogger } from '@/lib/logger';
import type { ApiScope, CallerKind } from '@/lib/auth/caller';

export type AuditOutcome = 'ok' | 'denied' | 'client_error' | 'rate_limited' | 'error';

export interface AuditEvent {
  surface: 'rest' | 'graphql' | 'mcp';
  action: string;
  scope: ApiScope;
  intentHash: string | null;
  outcome: AuditOutcome;
  status: number;
  requestId: string;
  callerId: string;
  callerKind: CallerKind;
  timestamp?: string;
}

const MAX_IN_MEMORY_EVENTS = 1_000;
const events: AuditEvent[] = [];

export function recordAuditEvent(event: AuditEvent): void {
  const entry: AuditEvent = {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  };

  events.push(entry);
  if (events.length > MAX_IN_MEMORY_EVENTS) {
    events.shift();
  }

  getLogger('audit').info({
    event: 'audit_event',
    ...entry,
  });
}

export function getAuditEvents(): readonly AuditEvent[] {
  return events;
}

export function clearAuditEvents(): void {
  events.length = 0;
}
