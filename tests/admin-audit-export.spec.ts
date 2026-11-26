/**
 * @vitest-environment node
 *
 * Issue #2216 (AGS023) — Admin audit-log export route tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/admin/audit/export/route';
import { InMemoryAuditStore, _setAuditStore } from '@/lib/audit/store';
import { InMemoryApiKeyStore, _setApiKeyStore } from '@/lib/auth/key-store';
import { hashApiKey } from '@/lib/auth/api-keys';
import type { AuditEvent } from '@/lib/audit/types';
import { clearRateLimitStore } from '@/lib/api/rate-limit';

describe('admin audit export route (#2216)', () => {
  let auditStore: InMemoryAuditStore;
  const adminKey = 'test-admin-secret-123';
  const adminCallerKeyRaw = 'sik_0123456789abcdef_1234567890123456789012345678901234567890123';
  const adminKeyId = '0123456789abcdef';

  const nonAdminCallerKeyRaw = 'sik_fedcba9876543210_1234567890123456789012345678901234567890123';
  const nonAdminKeyId = 'fedcba9876543210';

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    clearRateLimitStore();

    vi.stubEnv('ADMIN_SECRET_KEY', adminKey);

    auditStore = new InMemoryAuditStore();
    _setAuditStore(auditStore);

    const keyStore = new InMemoryApiKeyStore();
    // Key with admin scope
    await keyStore.create({
      keyId: adminKeyId,
      displayPrefix: `sik_${adminKeyId}`,
      hash: await hashApiKey(adminCallerKeyRaw),
      name: 'admin caller',
      scopes: ['admin'],
      tier: 'standard',
      maxIntentAmount: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });
    // Key without admin scope
    await keyStore.create({
      keyId: nonAdminKeyId,
      displayPrefix: `sik_${nonAdminKeyId}`,
      hash: await hashApiKey(nonAdminCallerKeyRaw),
      name: 'non-admin caller',
      scopes: ['quotes:read', 'intents:write'],
      tier: 'standard',
      maxIntentAmount: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });
    _setApiKeyStore(keyStore);
  });

  function createRequest(
    queryParams: Record<string, string>,
    headers: Record<string, string> = {}
  ): NextRequest {
    const url = new URL('http://localhost:3000/api/admin/audit/export');
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, v);
    }
    return new NextRequest(url.toString(), {
      method: 'GET',
      headers,
    });
  }

  it('No credentials: 403', async () => {
    const req = createRequest({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-02T00:00:00.000Z',
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('Admin header: 200', async () => {
    const req = createRequest(
      {
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-02T00:00:00.000Z',
      },
      { 'x-admin-key': adminKey }
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it('A caller key with admin scope: 200', async () => {
    const req = createRequest(
      {
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-02T00:00:00.000Z',
      },
      { authorization: `Bearer ${adminCallerKeyRaw}` }
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it('A key without admin: 403', async () => {
    const req = createRequest(
      {
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-02T00:00:00.000Z',
      },
      { authorization: `Bearer ${nonAdminCallerKeyRaw}` }
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('A 32-day range and from >= to both give 400', async () => {
    // 32-day range
    const req32 = createRequest(
      {
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-11-03T00:00:00.000Z', // 33 days
      },
      { 'x-admin-key': adminKey }
    );
    const res32 = await GET(req32);
    expect(res32.status).toBe(400);
    const body32 = await res32.json();
    expect(body32.code).toBe('VALIDATION_ERROR');

    // from >= to
    const reqFromGteTo = createRequest(
      {
        from: '2026-10-02T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
      },
      { 'x-admin-key': adminKey }
    );
    const resFromGteTo = await GET(reqFromGteTo);
    expect(resFromGteTo.status).toBe(400);
    const bodyFromGteTo = await resFromGteTo.json();
    expect(bodyFromGteTo.code).toBe('VALIDATION_ERROR');
  });

  it('The callerId filter works, and the Content-Disposition filename is correct', async () => {
    const event1: AuditEvent = {
      id: '1',
      at: '2026-10-01T12:00:00.000Z',
      requestId: null,
      surface: 'mcp',
      action: 'intel.corridors',
      callerId: 'anonymous',
      callerKind: 'anonymous',
      scope: null,
      intentHash: null,
      outcome: 'ok',
      status: null,
    };
    const event2: AuditEvent = {
      id: '2',
      at: '2026-10-01T13:00:00.000Z',
      requestId: null,
      surface: 'mcp',
      action: 'intel.offramp.prepare',
      callerId: `key:${adminKeyId}`,
      callerKind: 'key',
      scope: 'intents:write',
      intentHash: null,
      outcome: 'ok',
      status: null,
    };
    await auditStore.append(event1);
    await auditStore.append(event2);

    const req = createRequest(
      {
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-02T00:00:00.000Z',
        format: 'csv',
        callerId: `key:${adminKeyId}`,
      },
      { 'x-admin-key': adminKey }
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="audit-2026-10-01-2026-10-02.csv"'
    );
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');

    const csvText = await res.text();
    expect(csvText).toContain(adminKeyId);
    expect(csvText).not.toContain('intel.corridors');
  });

  it('50 001 seeded events give 50 000 rows and X-Audit-Truncated: true', async () => {
    // Seed 50_001 events
    // To speed up seeding in InMemoryAuditStore, append directly
    for (let i = 0; i < 50_001; i++) {
      const pad = String(i).padStart(6, '0');
      (auditStore as any).events.push({
        id: `event-${pad}`,
        at: '2026-10-01T12:00:00.000Z',
        requestId: null,
        surface: 'rest',
        action: 'v1.corridors',
        callerId: 'anonymous',
        callerKind: 'anonymous',
        scope: null,
        intentHash: null,
        outcome: 'ok',
        status: 200,
      });
    }

    const req = createRequest(
      {
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-02T00:00:00.000Z',
        format: 'ndjson',
      },
      { 'x-admin-key': adminKey }
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Audit-Truncated')).toBe('true');

    const text = await res.text();
    const lines = text.trim().split('\n');
    expect(lines.length).toBe(50_000);
  });
});
