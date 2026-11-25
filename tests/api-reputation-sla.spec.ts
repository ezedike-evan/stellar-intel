import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/reputation/[anchor]/sla/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import {
  createReputationStore,
  _setReputationStore,
  type ReputationStore,
} from '@/lib/reputation/store';
import { ExecutionSlaReportSchema } from '@/lib/reputation/execution-sla';
import { makeOutcomeRow } from './fixtures/outcome-rows';

let store: ReputationStore;

beforeEach(() => {
  clearRateLimitStore();
  store = createReputationStore({ backend: 'memory' });
  _setReputationStore(store);
});

afterEach(() => {
  _setReputationStore(null);
});

function slaRequest(anchor: string, corridor?: string): NextRequest {
  const url = new URL(`http://localhost/api/reputation/${anchor}/sla`);
  if (corridor) url.searchParams.set('corridor', corridor);
  return new NextRequest(url);
}

describe('GET /api/reputation/[anchor]/sla (#2144)', () => {
  it('returns 200 with ok state when anchor has 30 completed rows', async () => {
    for (let i = 0; i < 30; i++) {
      await store.append(
        makeOutcomeRow({
          intentHash: `hash-${i}`.padStart(64, '0'),
          anchorId: 'moneygram',
          corridor: 'usdc-ngn',
          settleSeconds: 60 + i,
          attested: true,
        })
      );
    }

    const res = await GET(slaRequest('moneygram'), { params: { anchor: 'moneygram' } });
    expect(res.status).toBe(200);

    const body = await res.json();
    const parsed = ExecutionSlaReportSchema.parse(body);

    expect(parsed.anchorId).toBe('moneygram');
    expect(parsed.overall.sla.state).toBe('ok');
    expect(parsed.overall.sla.sampleSize).toBe(30);

    const ngnEntry = parsed.corridors.find((c) => c.corridor === 'usdc-ngn');
    expect(ngnEntry?.sla.state).toBe('ok');
  });

  it('restricts corridors to single requested corridor when corridor query param is passed', async () => {
    for (let i = 0; i < 30; i++) {
      await store.append(
        makeOutcomeRow({
          intentHash: `hash-${i}`.padStart(64, '0'),
          anchorId: 'moneygram',
          corridor: 'usdc-ngn',
          settleSeconds: 60 + i,
          attested: true,
        })
      );
    }

    const res = await GET(slaRequest('moneygram', 'usdc-ngn'), {
      params: { anchor: 'moneygram' },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    const parsed = ExecutionSlaReportSchema.parse(body);
    expect(parsed.corridors).toHaveLength(1);
    expect(parsed.corridors[0]?.corridor).toBe('usdc-ngn');
  });

  it('answers 400 VALIDATION_ERROR when corridor is not served by anchor', async () => {
    const res = await GET(slaRequest('moneygram', 'ngnt-ngn'), {
      params: { anchor: 'moneygram' },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Anchor moneygram does not serve corridor ngnt-ngn',
    });
  });

  it('answers 404 NOT_FOUND for an unknown anchor', async () => {
    const res = await GET(slaRequest('not-an-anchor'), {
      params: { anchor: 'not-an-anchor' },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Unknown anchor: not-an-anchor',
    });
  });

  it('ignores unattested rows', async () => {
    for (let i = 0; i < 30; i++) {
      await store.append(
        makeOutcomeRow({
          intentHash: `unattested-${i}`.padStart(64, '0'),
          anchorId: 'moneygram',
          corridor: 'usdc-ngn',
          settleSeconds: 50,
          attested: false,
        })
      );
    }

    const res = await GET(slaRequest('moneygram'), { params: { anchor: 'moneygram' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = ExecutionSlaReportSchema.parse(body);
    expect(parsed.overall.sla.state).toBe('insufficient_data');
    expect(parsed.overall.sla.sampleSize).toBe(0);
  });

  it('the 200 body has history with 30 entries (#2145)', async () => {
    const res = await GET(slaRequest('moneygram'), { params: { anchor: 'moneygram' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.history)).toBe(true);
    expect(body.history).toHaveLength(30);
  });
});
