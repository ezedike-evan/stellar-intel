/**
 * lib/audit/export.ts
 *
 * Serialization helpers for admin audit-log exports (AGS023).
 */

import type { AuditEvent } from './types';

export const AUDIT_CSV_COLUMNS = [
  'id',
  'at',
  'requestId',
  'surface',
  'action',
  'callerId',
  'callerKind',
  'scope',
  'intentHash',
  'outcome',
  'status',
] as const;

export function toNdjson(events: AuditEvent[]): string {
  if (events.length === 0) return '';
  return (
    events
      .map((event) => {
        const ordered: Record<string, unknown> = {};
        for (const col of AUDIT_CSV_COLUMNS) {
          ordered[col] = event[col] ?? null;
        }
        return JSON.stringify(ordered);
      })
      .join('\n') + '\n'
  );
}

function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return '';

  let str = String(val);
  // Formula-injection guard: prefix ' to any field starting with =, +, -, or @
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }

  // RFC 4180 quoting: quote a field containing comma, quote, CR, or LF, doubling inner quotes
  if (/[,"\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(events: AuditEvent[]): string {
  const header = AUDIT_CSV_COLUMNS.join(',') + '\r\n';
  if (events.length === 0) return header;

  const rows = events.map((event) =>
    AUDIT_CSV_COLUMNS.map((col) => escapeCsvField(event[col])).join(',')
  );

  return header + rows.join('\r\n') + '\r\n';
}
