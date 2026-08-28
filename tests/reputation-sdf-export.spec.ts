import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import {
  buildSdfAnchorDirectoryExport,
  SDF_EXPORT_SCHEMA_VERSION,
} from '@/lib/reputation/sdfExport';
import type { AnchorHealth } from '@/lib/stellar/anchors';
import type { Anchor } from '@/types';
import type { ProbeLedgerRow } from '@/types/reputation';
import { GET } from '@/app/api/reputation/sdf-export/route';
import { InMemoryReputationStore, _setReputationStore } from '@/lib/reputation/store';

const NOW = new Date('2026-07-25T15:00:00.000Z');

const ANCHOR: Anchor = {
  id: 'cowrie',
  name: 'Cowrie Exchange',
  homeDomain: 'cowrie.exchange',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: 'ISSUER',
  seps: ['sep6', 'sep10'],
};

function uptimeRow(domain: string, reachable: boolean, latencyMs: number): ProbeLedgerRow {
  return {
    domain,
    kind: 'uptime',
    corridor: null,
    reachable,
    latencyMs,
    failureType: reachable ? null : 'timeout',
    error: reachable ? null : 'timed out',
    probedAt: NOW.toISOString(),
  };
}

function quoteRow(domain: string, corridor: string, latencyMs: number): ProbeLedgerRow {
  return {
    domain,
    kind: 'quote',
    corridor,
    reachable: true,
    latencyMs,
    failureType: null,
    error: null,
    probedAt: NOW.toISOString(),
  };
}

describe('buildSdfAnchorDirectoryExport', () => {
  it('reports unknown status with no health record and no probe samples', () => {
    const report = buildSdfAnchorDirectoryExport([ANCHOR], new Map(), new Map(), () => NOW);

    expect(report.schemaVersion).toBe(SDF_EXPORT_SCHEMA_VERSION);
    expect(report.generatedAt).toBe(NOW.toISOString());
    expect(report.anchors).toHaveLength(1);

    const entry = report.anchors[0]!;
    expect(entry.anchorId).toBe('cowrie');
    expect(entry.health.status).toBe('unknown');
    expect(entry.health.lastStatus).toBeNull();
    expect(entry.health.uptime).toBeNull();
    expect(entry.health.avgLatencyMs).toBeNull();
    expect(entry.health.quoteLatencyByCorridor).toEqual({});
  });

  it('derives status from the health ledger and computes uptime/latency from probe rows', () => {
    const health: AnchorHealth = {
      consecutiveFailures: 0,
      degraded: false,
      lastCheckedAt: '2026-07-25T00:00:00.000Z',
      lastStatus: 'ok',
      lastError: null,
    };
    const probeRows = new Map([
      [
        'cowrie.exchange',
        [
          uptimeRow('cowrie.exchange', true, 100),
          uptimeRow('cowrie.exchange', true, 200),
          uptimeRow('cowrie.exchange', false, 0),
          quoteRow('cowrie.exchange', 'usdc-ngn', 300),
        ],
      ],
    ]);

    const report = buildSdfAnchorDirectoryExport(
      [ANCHOR],
      new Map([['cowrie', health]]),
      probeRows,
      () => NOW
    );

    const entry = report.anchors[0]!;
    expect(entry.health.status).toBe('healthy');
    expect(entry.health.lastStatus).toBe('ok');
    expect(entry.health.uptime).toBeCloseTo(2 / 3);
    expect(entry.health.avgLatencyMs).toBe(150);
    expect(entry.health.quoteLatencyByCorridor['usdc-ngn']).toMatchObject({
      p50Ms: 300,
      sampleCount: 1,
    });
  });

  it('reports degraded status when the health ledger flags the anchor', () => {
    const health: AnchorHealth = {
      consecutiveFailures: 4,
      degraded: true,
      lastCheckedAt: '2026-07-25T00:00:00.000Z',
      lastStatus: 'fail',
      lastError: 'ENOTFOUND',
    };
    const report = buildSdfAnchorDirectoryExport(
      [ANCHOR],
      new Map([['cowrie', health]]),
      new Map(),
      () => NOW
    );
    expect(report.anchors[0]!.health.status).toBe('degraded');
    expect(report.anchors[0]!.health.consecutiveFailures).toBe(4);
  });
});

describe('GET /api/reputation/sdf-export', () => {
  it('returns a JSON export built from live probe rows', async () => {
    const store = new InMemoryReputationStore();
    _setReputationStore(store);

    await store.recordProbeSample(uptimeRow('cowrie.exchange', true, 50));
    await store.recordProbeSample(uptimeRow('stellar.moneygram.com', true, 80));

    const res = await GET(new NextRequest('http://localhost/api/reputation/sdf-export'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.schemaVersion).toBe(SDF_EXPORT_SCHEMA_VERSION);
    expect(Array.isArray(body.anchors)).toBe(true);
    const cowrie = body.anchors.find((a: { anchorId: string }) => a.anchorId === 'cowrie');
    expect(cowrie).toBeDefined();
    expect(cowrie.health.uptime).toBe(1);

    _setReputationStore(null);
  });
});
