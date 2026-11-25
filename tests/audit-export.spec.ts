/**
 * @vitest-environment node
 *
 * Issue #2216 (AGS023) — Unit tests for lib/audit/export.ts
 */

import { describe, it, expect } from 'vitest';
import { AUDIT_CSV_COLUMNS, toNdjson, toCsv } from '@/lib/audit/export';
import type { AuditEvent } from '@/lib/audit/types';

describe('audit export unit tests (#2216)', () => {
  const sampleEvent: AuditEvent = {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    at: '2026-10-01T12:00:00.000Z',
    requestId: 'req-123',
    surface: 'mcp',
    action: 'intel.offramp.prepare',
    callerId: 'key:0123456789abcdef',
    callerKind: 'key',
    scope: 'intents:write',
    intentHash: 'a'.repeat(64),
    outcome: 'ok',
    status: null,
  };

  it('NDJSON lines parse back to the events with keys in AUDIT_CSV_COLUMNS order', () => {
    const ndjson = toNdjson([sampleEvent]);
    expect(ndjson.endsWith('\n')).toBe(true);

    const line = ndjson.trim();
    const parsed = JSON.parse(line);
    expect(parsed).toEqual({
      id: sampleEvent.id,
      at: sampleEvent.at,
      requestId: sampleEvent.requestId,
      surface: sampleEvent.surface,
      action: sampleEvent.action,
      callerId: sampleEvent.callerId,
      callerKind: sampleEvent.callerKind,
      scope: sampleEvent.scope,
      intentHash: sampleEvent.intentHash,
      outcome: sampleEvent.outcome,
      status: null,
    });
    expect(Object.keys(parsed)).toEqual([...AUDIT_CSV_COLUMNS]);

    // Empty input gives ''
    expect(toNdjson([])).toBe('');
  });

  it('The header row matches AUDIT_CSV_COLUMNS', () => {
    const csv = toCsv([]);
    expect(csv).toBe(AUDIT_CSV_COLUMNS.join(',') + '\r\n');
  });

  it('CSV quoting of a value with a comma, a quote and a newline', () => {
    const complexEvent: AuditEvent = {
      ...sampleEvent,
      action: 'action,with"quote\nand\rnewline',
    };

    const csv = toCsv([complexEvent]);
    const lines = csv.split('\r\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // Should be quoted with doubled inner quote
    expect(csv).toContain('"action,with""quote\nand\rnewline"');
  });

  it("=cmd() becomes '='cmd() due to formula injection guard", () => {
    const formulaEvent: AuditEvent = {
      ...sampleEvent,
      action: '=cmd()',
    };

    const csv = toCsv([formulaEvent]);
    expect(csv).toContain("'=cmd()");
  });

  it('+ - and @ also get prefixed with single quote', () => {
    const plusEvent: AuditEvent = { ...sampleEvent, action: '+123' };
    const minusEvent: AuditEvent = { ...sampleEvent, action: '-test' };
    const atEvent: AuditEvent = { ...sampleEvent, action: '@admin' };

    expect(toCsv([plusEvent])).toContain("'+123");
    expect(toCsv([minusEvent])).toContain("'-test");
    expect(toCsv([atEvent])).toContain("'@admin");
  });

  it('null becomes an empty field', () => {
    const nullEvent: AuditEvent = {
      ...sampleEvent,
      requestId: null,
      scope: null,
      intentHash: null,
      status: null,
    };

    const csv = toCsv([nullEvent]);
    const lines = csv.split('\r\n');
    const dataRow = lines[1]!;
    const fields = dataRow.split(',');

    // requestId is index 2
    expect(fields[2]).toBe('');
    // scope is index 7
    expect(fields[7]).toBe('');
    // intentHash is index 8
    expect(fields[8]).toBe('');
    // status is index 10
    expect(fields[10]).toBe('');
  });
});
