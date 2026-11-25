import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const warn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({
  getLogger: vi.fn(() => ({ warn, info: vi.fn(), error: vi.fn() })),
}));

import {
  InMemoryAuditStore,
  getAuditStore,
  _setAuditStore,
  type AuditEvent,
} from '@/lib/audit/store';
import { recordAuditEvent, flushAuditEvents } from '@/lib/audit/record';

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: globalThis.crypto.randomUUID(),
    at: '2026-11-21T10:00:00.000Z',
    requestId: 'req-1',
    surface: 'rest',
    action: 'v1.intent.offramp',
    callerId: 'anonymous',
    callerKind: 'anonymous',
    scope: 'intents:write',
    intentHash: 'a'.repeat(64),
    outcome: 'ok',
    status: 200,
    ...overrides,
  };
}

describe('lib/audit store and recorder (#2206)', () => {
  let store: InMemoryAuditStore;

  beforeEach(() => {
    warn.mockClear();
    store = new InMemoryAuditStore();
    _setAuditStore(store);
  });

  afterEach(() => {
    _setAuditStore(null);
  });

  it('in-memory listRange: half-open range, ordering, limit, callerId filter', async () => {
    const e1 = makeEvent({ id: 'id-1', at: '2026-11-21T09:00:00.000Z', callerId: 'key:1' });
    const e2 = makeEvent({ id: 'id-2', at: '2026-11-21T10:00:00.000Z', callerId: 'key:1' });
    const e3 = makeEvent({ id: 'id-3', at: '2026-11-21T10:00:00.000Z', callerId: 'key:2' });
    const e4 = makeEvent({ id: 'id-4', at: '2026-11-21T11:00:00.000Z', callerId: 'key:1' });

    await store.append(e1);
    await store.append(e2);
    await store.append(e3);
    await store.append(e4);

    // Half-open range [09:00, 11:00) excludes e4 at 11:00
    const inRange = await store.listRange({
      from: '2026-11-21T09:00:00.000Z',
      to: '2026-11-21T11:00:00.000Z',
      limit: 10,
    });
    expect(inRange.map((e) => e.id)).toEqual(['id-1', 'id-2', 'id-3']);

    // CallerId filter
    const key1Only = await store.listRange({
      from: '2026-11-21T09:00:00.000Z',
      to: '2026-11-21T12:00:00.000Z',
      limit: 10,
      callerId: 'key:1',
    });
    expect(key1Only.map((e) => e.id)).toEqual(['id-1', 'id-2', 'id-4']);

    // Limit capped
    const limited = await store.listRange({
      from: '2026-11-21T09:00:00.000Z',
      to: '2026-11-21T12:00:00.000Z',
      limit: 2,
    });
    expect(limited.length).toBe(2);
    expect(limited.map((e) => e.id)).toEqual(['id-1', 'id-2']);
  });

  it('recordAuditEvent nulls a bad intentHash and maps a bad action to unknown', async () => {
    recordAuditEvent({
      requestId: 'req-1',
      surface: 'rest',
      action: 'bad action with spaces & symbols!',
      callerId: 'anonymous',
      callerKind: 'anonymous',
      scope: 'quotes:read',
      intentHash: 'not-a-64-hex-string',
      outcome: 'ok',
      status: 200,
    });
    await flushAuditEvents();

    const events = await store.listRange({
      from: '1970-01-01T00:00:00.000Z',
      to: '2100-01-01T00:00:00.000Z',
      limit: 10,
    });
    expect(events.length).toBe(1);
    expect(events[0]!.intentHash).toBeNull();
    expect(events[0]!.action).toBe('unknown');
  });

  it('a rejecting store does not throw, and logs once for two failures in the same minute', async () => {
    vi.spyOn(store, 'append').mockRejectedValue(new Error('store append failed'));

    expect(() => {
      recordAuditEvent({
        requestId: 'req-1',
        surface: 'rest',
        action: 'v1.health',
        callerId: 'anonymous',
        callerKind: 'anonymous',
        scope: 'quotes:read',
        intentHash: null,
        outcome: 'ok',
        status: 200,
      });
      recordAuditEvent({
        requestId: 'req-2',
        surface: 'rest',
        action: 'v1.health',
        callerId: 'anonymous',
        callerKind: 'anonymous',
        scope: 'quotes:read',
        intentHash: null,
        outcome: 'ok',
        status: 200,
      });
    }).not.toThrow();

    await flushAuditEvents();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'audit_append_failed' }));
  });

  it('flushAuditEvents resolves after appends', async () => {
    let resolved = false;
    vi.spyOn(store, 'append').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      resolved = true;
    });

    recordAuditEvent({
      requestId: 'req-1',
      surface: 'rest',
      action: 'v1.health',
      callerId: 'anonymous',
      callerKind: 'anonymous',
      scope: 'quotes:read',
      intentHash: null,
      outcome: 'ok',
      status: 200,
    });

    expect(resolved).toBe(false);
    await flushAuditEvents();
    expect(resolved).toBe(true);
  });

  it('source check: no file in lib/audit/ contains UPDATE or DELETE', () => {
    const auditDir = join(process.cwd(), 'lib', 'audit');
    const files = readdirSync(auditDir);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      if (!file.endsWith('.ts')) continue;
      const content = readFileSync(join(auditDir, file), 'utf8');
      expect(content).not.toMatch(/\bUPDATE\b|\bDELETE\b/i);
    }
  });
});
