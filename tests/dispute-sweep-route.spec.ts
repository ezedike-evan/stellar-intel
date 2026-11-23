// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/reputation/dispute-sweep/route';
import { _setDisputeStore, InMemoryDisputeStore, type Dispute } from '@/lib/reputation/disputes';
import { _setAdjudicationLog, InMemoryAdjudicationLog } from '@/lib/reputation/adjudication-log';
import { HOUR_MS, levelDeadline } from '@/lib/reputation/dispute-ladder';

function req(method: 'GET' | 'POST', authorization?: string): NextRequest {
  return new NextRequest('http://localhost/api/reputation/dispute-sweep', {
    method,
    headers: authorization ? { authorization } : {},
  });
}

function overdueDispute(): Dispute {
  const createdAt = new Date(Date.now() - 80 * HOUR_MS).toISOString();
  return {
    id: 'disp-route-0001',
    intentHash: 'b'.repeat(64),
    publicKey: 'G'.padEnd(56, 'B'),
    anchorId: 'moneygram',
    reason: 'delayed payment',
    status: 'open',
    createdAt,
    resolvedAt: null,
    category: 'delayed',
    level: 'anchor',
    levelDeadline: levelDeadline('anchor', createdAt),
    subjectKind: 'outcome',
    subjectRef: 'b'.repeat(64),
    appealedAt: null,
  };
}

describe('GET|POST /api/reputation/dispute-sweep (#2138)', () => {
  let disputes: InMemoryDisputeStore;
  let log: InMemoryAdjudicationLog;

  beforeEach(() => {
    disputes = new InMemoryDisputeStore();
    log = new InMemoryAdjudicationLog();
    _setDisputeStore(disputes);
    _setAdjudicationLog(log);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    _setDisputeStore(null);
    _setAdjudicationLog(null);
  });

  it('returns 500 when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = await GET(req('GET', 'Bearer anything'));
    expect(res.status).toBe(500);
  });

  it('returns 401 for a wrong bearer token', async () => {
    vi.stubEnv('CRON_SECRET', 'right-secret');
    const res = await GET(req('GET', 'Bearer wrong-secret'));
    expect(res.status).toBe(401);
    expect(await log.list()).toHaveLength(0);
  });

  it('returns 200 with counts for the correct bearer token', async () => {
    vi.stubEnv('CRON_SECRET', 'right-secret');
    await disputes.create(overdueDispute());

    const res = await GET(req('GET', 'Bearer right-secret'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scanned: 1, escalated: 1 });
    expect(await log.list()).toHaveLength(1);
  });

  it('serves POST through the same handler', async () => {
    vi.stubEnv('CRON_SECRET', 'right-secret');

    const res = await POST(req('POST', 'Bearer right-secret'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scanned: 0, escalated: 0 });
  });
});
