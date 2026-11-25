// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/reputation/dispute-sweep/route';
import { _setDisputeStore, InMemoryDisputeStore } from '@/lib/reputation/disputes';
import { _setAdjudicationLog, InMemoryAdjudicationLog } from '@/lib/reputation/adjudication-log';
import { _setRefundStore, InMemoryRefundStore } from '@/lib/refunds/store';

describe('/api/reputation/dispute-sweep route (#2126)', () => {
  beforeEach(() => {
    _setDisputeStore(new InMemoryDisputeStore());
    _setAdjudicationLog(new InMemoryAdjudicationLog());
    _setRefundStore(new InMemoryRefundStore());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    _setDisputeStore(null);
    _setAdjudicationLog(null);
    _setRefundStore(null);
  });

  it('no CRON_SECRET configured -> 500', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const req = new NextRequest('http://localhost/api/reputation/dispute-sweep', {
      method: 'GET',
    });
    const res = await GET(req);
    expect(res.status).toBe(500);
  });

  it('wrong bearer token -> 401', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    const req = new NextRequest('http://localhost/api/reputation/dispute-sweep', {
      method: 'GET',
      headers: { authorization: 'Bearer wrong-secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('correct bearer token -> 200 with scanned, escalated, refundDisputesOpened', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    const req = new NextRequest('http://localhost/api/reputation/dispute-sweep', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.scanned).toBe('number');
    expect(typeof body.escalated).toBe('number');
    expect(typeof body.refundDisputesOpened).toBe('number');
    expect(body.sweptAt).toBeDefined();
  });
});
