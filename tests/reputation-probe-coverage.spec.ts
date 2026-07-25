import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import {
  buildProbeCoverageReport,
  PROBE_MAINNET_READINESS_DAYS,
  type ProbeCoverageSample,
} from '@/lib/reputation/aggregate';
import { buildDemoProbeSamples } from '../scripts/probe-coverage-report';
import { GET } from '@/app/api/reputation/probe-coverage/route';
import { InMemoryReputationStore, _setReputationStore } from '@/lib/reputation/store';
import type { ProbeLedgerRow } from '@/types/reputation';

const NOW = new Date('2026-07-25T15:00:00.000Z');
const ANCHORS = [
  { anchorId: 'cowrie', domain: 'cowrie.exchange' },
  { anchorId: 'moneygram', domain: 'stellar.moneygram.com' },
];

function probe(domain: string, day: string): ProbeCoverageSample {
  return { probedAt: `${day}T08:00:00.000Z`, kind: 'uptime' };
}

describe('buildProbeCoverageReport', () => {
  it('counts continuous days and flags internal gaps on the seeded demo dataset', () => {
    const samples = buildDemoProbeSamples(NOW);
    const report = buildProbeCoverageReport(samples, ANCHORS, { now: NOW });

    expect(report.thresholdDays).toBe(PROBE_MAINNET_READINESS_DAYS);
    expect(report.asOfDay).toBe('2026-07-25');

    const cowrie = report.anchors.find((a) => a.anchorId === 'cowrie')!;
    expect(cowrie.continuousDays).toBe(12);
    expect(cowrie.hasCoverageGaps).toBe(false);
    expect(cowrie.daysUntilThreshold).toBe(PROBE_MAINNET_READINESS_DAYS - 12);

    const moneygram = report.anchors.find((a) => a.anchorId === 'moneygram')!;
    expect(moneygram.continuousDays).toBe(3);
    expect(moneygram.hasCoverageGaps).toBe(true);
    expect(moneygram.gaps).toHaveLength(1);
    expect(moneygram.gaps[0]).toMatchObject({ start: '2026-07-18', end: '2026-07-22', days: 5 });

    expect(report.daysUntilFleetThreshold).toBe(PROBE_MAINNET_READINESS_DAYS - 3);
    expect(report.fleetThresholdMet).toBe(false);
  });

  it('treats quote-only samples as non-coverage', () => {
    const samples = new Map<string, ProbeCoverageSample[]>([
      ['cowrie.exchange', [{ probedAt: '2026-07-25T08:00:00.000Z', kind: 'quote' }]],
    ]);
    const report = buildProbeCoverageReport(samples, [ANCHORS[0]!], { now: NOW });
    expect(report.anchors[0]!.continuousDays).toBe(0);
    expect(report.anchors[0]!.coveredDays).toBe(0);
  });

  it('reports a clean streak when every day is covered', () => {
    const days = ['2026-07-23', '2026-07-24', '2026-07-25'];
    const samples = new Map([
      ['cowrie.exchange', days.map((d) => probe('cowrie.exchange', d))],
    ]);
    const report = buildProbeCoverageReport(samples, [ANCHORS[0]!], { now: NOW });
    expect(report.anchors[0]!.continuousDays).toBe(3);
    expect(report.anchors[0]!.hasCoverageGaps).toBe(false);
  });
});

describe('GET /api/reputation/probe-coverage', () => {
  it('returns JSON shaped like the CLI report', async () => {
    const store = new InMemoryReputationStore();
    _setReputationStore(store);
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    const row = (at: Date): ProbeLedgerRow => ({
      domain: 'cowrie.exchange',
      kind: 'uptime',
      corridor: null,
      reachable: true,
      latencyMs: 40,
      failureType: null,
      error: null,
      probedAt: at.toISOString(),
    });
    await store.recordProbeSample(row(yesterday));
    await store.recordProbeSample(row(today));

    const res = await GET(new NextRequest('http://localhost/api/reputation/probe-coverage'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.thresholdDays).toBe(90);
    expect(Array.isArray(body.anchors)).toBe(true);
    const cowrie = body.anchors.find((a: { anchorId: string }) => a.anchorId === 'cowrie');
    expect(cowrie?.continuousDays).toBe(2);

    _setReputationStore(null);
  });
});
