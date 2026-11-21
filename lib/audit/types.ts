/**
 * lib/audit/types.ts
 *
 * Types for the append-only audit trail (AGS013).
 * Deliberately contains no IP address, user sender/recipient addresses, amount, or body field (no PII).
 */

import type { ApiScope } from '@/lib/auth/api-keys';

export type AuditSurface = 'rest' | 'mcp' | 'graphql';
export type AuditOutcome = 'ok' | 'client_error' | 'denied' | 'rate_limited' | 'error';

export interface AuditEvent {
  id: string; // crypto.randomUUID()
  at: string; // ISO
  requestId: string | null;
  surface: AuditSurface;
  action: string; // v1 bucket (e.g. 'v1.intent.offramp'), MCP tool name, or 'Mutation.submitOfframpIntent'
  callerId: string; // Caller.id: 'anonymous' or 'key:<keyId>'
  callerKind: 'anonymous' | 'key' | 'token';
  scope: ApiScope | null;
  intentHash: string | null; // 64 lowercase hex or null
  outcome: AuditOutcome;
  status: number | null; // HTTP status for rest/graphql; null for mcp
}

export interface AuditQuery {
  from: string;
  to: string;
  limit: number;
  callerId?: string;
}

export interface AuditStore {
  append(event: AuditEvent): Promise<void>;
  listRange(q: AuditQuery): Promise<AuditEvent[]>;
}
