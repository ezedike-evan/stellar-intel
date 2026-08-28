import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  aggregateProbeSignals,
  buildProbeSignalsPayload,
  fetchProbeSamples,
  publishProbeSignals,
  runBatch,
  type BatchConfig,
  type OutcomeRow,
  type QueryExecutor,
  type ProbeLedgerRow,
} from '../src/batch';

const SAMPLE_OUTCOME: OutcomeRow = {
  intentHash: 'abc123',
  anchorId: 'cowrie',
  corridor: 'usdc-ngn',
  outcome: 'completed',
  settleSeconds: 120,
  quotedRate: '1550.00',
  deliveredRate: '1548.50',
};

function dbOutcomeRow(row: OutcomeRow): Record<string, unknown> {
  return {
    intent_hash: row.intentHash,
    anchor_id: row.anchorId,
    corridor: row.corridor,
    outcome: row.outcome,
    settle_seconds: row.settleSeconds != null ? String(row.settleSeconds) : null,
    quoted_rate: row.quotedRate,
    delivered_rate: row.deliveredRate,
  };
}

function makeProbeRow(overrides: Partial<ProbeLedgerRow> & { domain: string }): ProbeLedgerRow {
  return {
    kind: 'uptime',
    corridor: null,
    reachable: true,
    latencyMs: 42,
    failureType: null,
    error: null,
    probedAt: new Date().toISOString(),
    ...overrides,
  };
}

const BASE_CONFIG: BatchConfig = {
  batchSize: 10,
  executor: vi.fn().mockResolvedValue({ rows: [] }) as unknown as QueryExecutor,
  oracleContractId: 'CABC123TEST',
  networkPassphrase: 'Test SDF Network ; September 2015',
  publisherSecret: 'STEST000000000000000000000000000000000000000000000000000000',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  rpcUrl: 'https://soroban-testnet.stellar.org',
};

const sdkMocks = vi.hoisted(() => ({
  submitOutcome: vi.fn(),
  publishCorridorRate: vi.fn(),
  publishProbeSignals: vi.fn(),
  signAndSend: vi.fn(),
}));

vi.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    fromSecret: vi.fn().mockReturnValue({ publicKey: () => 'GPUBLISHERMOCK' }),
  },
  contract: {
    basicNodeSigner: vi.fn().mockReturnValue({ signTransaction: vi.fn() }),
    Client: {
      from: vi.fn().mockResolvedValue({
        submit_outcome: sdkMocks.submitOutcome,
        publish_corridor_rate: sdkMocks.publishCorridorRate,
        publish_probe_signals: sdkMocks.publishProbeSignals,
      }),
    },
  },
}));

beforeEach(() => {
  sdkMocks.signAndSend.mockReset().mockResolvedValue({
    sendTransactionResponse: { hash: 'mock-tx-hash' },
  });
  sdkMocks.submitOutcome.mockReset().mockResolvedValue({ signAndSend: sdkMocks.signAndSend });
  sdkMocks.publishCorridorRate.mockReset().mockResolvedValue({ signAndSend: sdkMocks.signAndSend });
  sdkMocks.publishProbeSignals.mockReset().mockResolvedValue({ signAndSend: sdkMocks.signAndSend });
});

describe('aggregateProbeSignals', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');
  const within = new Date('2026-08-14T10:00:00.000Z').toISOString();
  const outside = new Date('2026-08-01T10:00:00.000Z').toISOString();

  it('aggregates uptime ratio, latency p50/p95, and drift counts per anchor from fixture samples', () => {
    const rows: ProbeLedgerRow[] = [
      // cowrie — 3 uptime (2 reachable), 3 quote latencies (100,200,300), 1 drift flagged
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'uptime', reachable: true, probedAt: within }),
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'uptime', reachable: true, probedAt: within }),
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'uptime', reachable: false, failureType: 'timeout', error: 'timeout', probedAt: within }),
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'quote', reachable: true, latencyMs: 100, probedAt: within }),
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'quote', reachable: true, latencyMs: 200, probedAt: within }),
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'quote', reachable: true, latencyMs: 300, probedAt: within }),
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'quote', reachable: false, latencyMs: 0, error: 'drift flagged: rate off by 10%', probedAt: within }),

      // ngnc — all reachable uptime, single latency sample, no drift
      makeProbeRow({ domain: 'ngnc.online', kind: 'uptime', reachable: true, probedAt: within }),
      makeProbeRow({ domain: 'ngnc.online', kind: 'uptime', reachable: true, probedAt: within }),
      makeProbeRow({ domain: 'ngnc.online', kind: 'quote', reachable: true, latencyMs: 150, probedAt: within }),

      // outside window — should be ignored
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'uptime', reachable: true, probedAt: outside }),
    ];

    const payload = aggregateProbeSignals(rows, {
      now,
      windowDays: 7,
      domainToAnchorId: { 'cowrie.exchange': 'cowrie', 'ngnc.online': 'ngnc' },
    });

    expect(payload.version).toBe(1);
    expect(payload.signals).toHaveLength(2);
    const cowrie = payload.signals.find((s) => s.anchorId === 'cowrie')!;
    const ngnc = payload.signals.find((s) => s.anchorId === 'ngnc')!;

    // uptime ratio: cowrie 2/3 ≈ 0.666, ngnc 2/2 = 1
    expect(cowrie.uptimeRatio).toBeCloseTo(2 / 3, 5);
    expect(ngnc.uptimeRatio).toBe(1);

    // latency p50/p95: cowrie sorted [100,200,300] => p50=200, p95=300 (nearest-rank)
    expect(cowrie.p50LatencyMs).toBe(200);
    expect(cowrie.p95LatencyMs).toBe(300);
    expect(ngnc.p50LatencyMs).toBe(150);
    expect(ngnc.p95LatencyMs).toBe(150);

    // drift: cowrie has 1 flagged via error containing "drift"
    expect(cowrie.driftFlagCount).toBe(1);
    expect(ngnc.driftFlagCount).toBe(0);
  });

  it('returns null p50/p95 when no reachable quote samples', () => {
    const rows: ProbeLedgerRow[] = [
      makeProbeRow({ domain: 'anclap.com', kind: 'uptime', reachable: true, probedAt: within }),
      makeProbeRow({ domain: 'anclap.com', kind: 'quote', reachable: false, latencyMs: 0, error: 'timeout', probedAt: within }),
    ];
    const payload = aggregateProbeSignals(rows, { domainToAnchorId: { 'anclap.com': 'anclap' } });
    const anclap = payload.signals.find((s) => s.anchorId === 'anclap')!;
    expect(anclap.p50LatencyMs).toBeNull();
    expect(anclap.p95LatencyMs).toBeNull();
    expect(anclap.uptimeRatio).toBe(1);
  });

  it('returns null uptimeRatio when no uptime samples', () => {
    const rows: ProbeLedgerRow[] = [
      makeProbeRow({ domain: 'anclap.com', kind: 'quote', reachable: true, latencyMs: 120, probedAt: within }),
    ];
    const payload = aggregateProbeSignals(rows, { domainToAnchorId: { 'anclap.com': 'anclap' } });
    expect(payload.signals[0]!.uptimeRatio).toBeNull();
  });

  it('respects configurable windowDays', () => {
    const rows: ProbeLedgerRow[] = [
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'uptime', reachable: true, probedAt: within }),
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'uptime', reachable: true, probedAt: outside }),
    ];
    // 7-day window excludes outside sample (uptime 1/1 =1)
    const p7 = aggregateProbeSignals(rows, { now, windowDays: 7, domainToAnchorId: { 'cowrie.exchange': 'cowrie' } });
    expect(p7.signals[0]!.uptimeRatio).toBe(1);
    // 30-day window includes both (2/2=1 still, but demonstrates windowing)
    const p30 = aggregateProbeSignals(rows, { now, windowDays: 30, domainToAnchorId: { 'cowrie.exchange': 'cowrie' } });
    expect(p30.signals[0]!.uptimeRatio).toBe(1);
    // If outside was unreachable, ratios would differ
    const rows2: ProbeLedgerRow[] = [
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'uptime', reachable: true, probedAt: within }),
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'uptime', reachable: false, probedAt: outside }),
    ];
    const p7b = aggregateProbeSignals(rows2, { now, windowDays: 7, domainToAnchorId: { 'cowrie.exchange': 'cowrie' } });
    expect(p7b.signals[0]!.uptimeRatio).toBe(1); // outside excluded
    const p30b = aggregateProbeSignals(rows2, { now, windowDays: 30, domainToAnchorId: { 'cowrie.exchange': 'cowrie' } });
    expect(p30b.signals[0]!.uptimeRatio).toBeCloseTo(0.5, 5); // both counted
  });

  it('falls back to domain as anchorId when no mapping', () => {
    const rows: ProbeLedgerRow[] = [
      makeProbeRow({ domain: 'unknown.example', kind: 'uptime', reachable: true, probedAt: within }),
    ];
    const payload = aggregateProbeSignals(rows);
    expect(payload.signals[0]!.anchorId).toBe('unknown.example');
  });
});

describe('buildProbeSignalsPayload', () => {
  it('wraps signals with version 1', () => {
    const payload = buildProbeSignalsPayload([
      { anchorId: 'cowrie', uptimeRatio: 1, p50LatencyMs: 100, p95LatencyMs: 200, driftFlagCount: 0 },
    ]);
    expect(payload.version).toBe(1);
    expect(payload.signals).toHaveLength(1);
    expect(payload.signals[0]!.anchorId).toBe('cowrie');
  });

  it('is versioned so consumer crate can distinguish shape', () => {
    const payload = buildProbeSignalsPayload([]);
    expect(payload.version).toBe(1);
    // JSON round-trips the version field, which the Rust consumer matches on.
    const json = JSON.stringify(payload);
    const parsed = JSON.parse(json) as { version: number };
    expect(parsed.version).toBe(1);
  });
});

describe('fetchProbeSamples', () => {
  it('maps snake_case probe_samples columns and filters by window', async () => {
    const now = new Date('2026-08-15T12:00:00.000Z');
    const within = new Date('2026-08-14T10:00:00.000Z').toISOString();
    const outside = new Date('2026-08-01T10:00:00.000Z').toISOString();
    const executor = vi.fn().mockResolvedValue({
      rows: [
        { domain: 'cowrie.exchange', kind: 'uptime', corridor: null, reachable: 1, latency_ms: 42, failure_type: null, error: null, probed_at: within },
        { domain: 'cowrie.exchange', kind: 'uptime', corridor: null, reachable: 0, latency_ms: 0, failure_type: 'timeout', error: 'timeout', probed_at: outside },
      ],
    });
    const rows = await fetchProbeSamples(executor as unknown as QueryExecutor, 7, now);
    expect(executor).toHaveBeenCalledWith(expect.stringContaining('probe_samples'), expect.any(Array));
    // only within window survives
    expect(rows).toHaveLength(1);
    expect(rows[0]!.domain).toBe('cowrie.exchange');
    expect(rows[0]!.reachable).toBe(true);
  });

  it('returns empty array when probe_samples table is missing (fresh DB)', async () => {
    const executor = vi.fn().mockRejectedValue(new Error('relation "probe_samples" does not exist'));
    const rows = await fetchProbeSamples(executor as unknown as QueryExecutor, 7);
    expect(rows).toEqual([]);
  });
});

describe('publishProbeSignals', () => {
  it('publishes versioned payload via contract and returns signal count', async () => {
    const payload = {
      version: 1 as const,
      signals: [
        { anchorId: 'cowrie', uptimeRatio: 1, p50LatencyMs: 100, p95LatencyMs: 200, driftFlagCount: 0 },
        { anchorId: 'ngnc', uptimeRatio: 0.5, p50LatencyMs: 150, p95LatencyMs: 300, driftFlagCount: 1 },
      ],
    };
    const n = await publishProbeSignals(payload, {
      oracleContractId: BASE_CONFIG.oracleContractId,
      networkPassphrase: BASE_CONFIG.networkPassphrase,
      publisherSecret: BASE_CONFIG.publisherSecret,
      rpcUrl: BASE_CONFIG.rpcUrl,
    });
    expect(n).toBe(2);
    expect(sdkMocks.publishProbeSignals).toHaveBeenCalledWith(
      expect.objectContaining({ payload: JSON.stringify(payload) })
    );
  });

  it('returns 0 and does not throw when contract has no entrypoint', async () => {
    // Simulate an older deployment with no probe method
    const { contract } = await import('@stellar/stellar-sdk');
    const originalFrom = (contract.Client as unknown as { from: typeof contract.Client.from }).from;
    (contract.Client as unknown as { from: unknown }).from = vi.fn().mockResolvedValue({
      submit_outcome: sdkMocks.submitOutcome,
      publish_corridor_rate: sdkMocks.publishCorridorRate,
      // no publish_probe_signals
    });
    const payload = {
      version: 1 as const,
      signals: [{ anchorId: 'cowrie', uptimeRatio: 1, p50LatencyMs: 100, p95LatencyMs: 200, driftFlagCount: 0 }],
    };
    const n = await publishProbeSignals(payload, {
      oracleContractId: BASE_CONFIG.oracleContractId,
      networkPassphrase: BASE_CONFIG.networkPassphrase,
      publisherSecret: BASE_CONFIG.publisherSecret,
      rpcUrl: BASE_CONFIG.rpcUrl,
    });
    expect(n).toBe(0);
    // restore
    (contract.Client as unknown as { from: unknown }).from = originalFrom;
  });

  it('returns 0 for empty signals without calling contract', async () => {
    const n = await publishProbeSignals({ version: 1, signals: [] }, {
      oracleContractId: BASE_CONFIG.oracleContractId,
      networkPassphrase: BASE_CONFIG.networkPassphrase,
      publisherSecret: BASE_CONFIG.publisherSecret,
      rpcUrl: BASE_CONFIG.rpcUrl,
    });
    expect(n).toBe(0);
    expect(sdkMocks.publishProbeSignals).not.toHaveBeenCalled();
  });
});

describe('runBatch — probe signals (D070)', () => {
  function makeOutcomeExecutor(rows: OutcomeRow[], probeRows: ProbeLedgerRow[] = []) {
    const updates: Array<{ intentHash: string; txHash: string }> = [];
    const executor = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('UPDATE outcome_log')) {
        const [txHash, intentHash] = params as [string, string];
        updates.push({ intentHash, txHash });
        return { rows: [] };
      }
      if (sql.includes('probe_samples')) {
        // Return probe rows mapped to DB shape (snake_case)
        return {
          rows: probeRows.map((r) => ({
            domain: r.domain,
            kind: r.kind,
            corridor: r.corridor,
            reachable: r.reachable ? 1 : 0,
            latency_ms: r.latencyMs,
            failure_type: r.failureType,
            error: r.error,
            probed_at: r.probedAt,
          })),
        };
      }
      return { rows: rows.map(dbOutcomeRow) };
    }) as unknown as QueryExecutor;
    return { executor, updates };
  }

  it('aggregates probe samples and publishes versioned payload alongside outcomes', async () => {
    const nowIso = new Date().toISOString();
    const probeRows: ProbeLedgerRow[] = [
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'uptime', reachable: true, probedAt: nowIso }),
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'quote', reachable: true, latencyMs: 120, probedAt: nowIso }),
    ];
    const { executor } = makeOutcomeExecutor([SAMPLE_OUTCOME], probeRows);
    sdkMocks.signAndSend.mockResolvedValue({ sendTransactionResponse: { hash: 'tx-1' } });

    const result = await runBatch({
      ...BASE_CONFIG,
      executor,
      probeSignals: {
        domainToAnchorId: { 'cowrie.exchange': 'cowrie' },
        loadProbeSamples: async () => probeRows,
      },
    });

    expect(result.submitted).toBe(1);
    expect(result.probeSignalsPublished).toBe(1);
    expect(result.probePayload?.version).toBe(1);
    expect(result.probePayload?.signals[0]!.anchorId).toBe('cowrie');
    expect(result.probeSignalsSkipped).toBe(false);
    expect(sdkMocks.publishProbeSignals).toHaveBeenCalledTimes(1);
  });

  it('empty-probe-data path: publishes outcomes only and logs that probe signals were skipped', async () => {
    const { executor } = makeOutcomeExecutor([SAMPLE_OUTCOME], []);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    sdkMocks.signAndSend.mockResolvedValue({ sendTransactionResponse: { hash: 'tx-1' } });

    const result = await runBatch({
      ...BASE_CONFIG,
      executor,
      probeSignals: {
        loadProbeSamples: async () => [],
      },
    });

    expect(result.submitted).toBe(1);
    expect(result.probeSignalsPublished).toBe(0);
    expect(result.probePayload).toBeNull();
    expect(result.probeSignalsSkipped).toBe(true);
    expect(sdkMocks.publishProbeSignals).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('probe signals skipped'));
    logSpy.mockRestore();
  });

  it('does not publish probe signals when probeSignals config is absent (backward compatible)', async () => {
    const { executor } = makeOutcomeExecutor([SAMPLE_OUTCOME], [
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'uptime', reachable: true }),
    ]);
    sdkMocks.signAndSend.mockResolvedValue({ sendTransactionResponse: { hash: 'tx-1' } });

    const result = await runBatch({ ...BASE_CONFIG, executor });

    expect(result.submitted).toBe(1);
    expect(result.probeSignalsPublished).toBeUndefined();
    expect(result.probePayload).toBeUndefined();
    expect(sdkMocks.publishProbeSignals).not.toHaveBeenCalled();
  });

  it('is resilient: a probe publish failure does not roll back outcomes', async () => {
    const probeRows: ProbeLedgerRow[] = [
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'uptime', reachable: true }),
    ];
    const { executor, updates } = makeOutcomeExecutor([SAMPLE_OUTCOME], probeRows);
    sdkMocks.signAndSend.mockResolvedValueOnce({ sendTransactionResponse: { hash: 'tx-1' } });
    sdkMocks.publishProbeSignals.mockRejectedValueOnce(new Error('HostError: contract logic rejected'));

    const result = await runBatch({
      ...BASE_CONFIG,
      executor,
      probeSignals: { loadProbeSamples: async () => probeRows },
    });

    // Outcome still marked even though probe publish failed
    expect(updates).toHaveLength(1);
    expect(result.submitted).toBe(1);
    expect(result.probeSignalsPublished).toBe(0);
  });

  it('uses configurable windowDays when fetching via executor', async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 2 * 86400000).toISOString();
    const old = new Date(now.getTime() - 20 * 86400000).toISOString();
    const probeRowsAll: ProbeLedgerRow[] = [
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'uptime', reachable: true, probedAt: recent }),
      makeProbeRow({ domain: 'cowrie.exchange', kind: 'uptime', reachable: false, probedAt: old }),
    ];
    // Use executor path (no thunk) with windowDays 7 — old sample outside window is excluded
    const callLog: string[] = [];
    const executor = vi.fn(async (sql: string) => {
      callLog.push(sql);
      if (sql.includes('probe_samples')) {
        return {
          rows: probeRowsAll.map((r) => ({
            domain: r.domain,
            kind: r.kind,
            corridor: r.corridor,
            reachable: r.reachable ? 1 : 0,
            latency_ms: r.latencyMs,
            failure_type: r.failureType,
            error: r.error,
            probed_at: r.probedAt,
          })),
        };
      }
      if (sql.includes('UPDATE')) return { rows: [] };
      return { rows: [dbOutcomeRow(SAMPLE_OUTCOME)] };
    }) as unknown as QueryExecutor;
    sdkMocks.signAndSend.mockResolvedValue({ sendTransactionResponse: { hash: 'tx-1' } });

    const result = await runBatch({
      ...BASE_CONFIG,
      executor,
      probeSignals: { windowDays: 7, domainToAnchorId: { 'cowrie.exchange': 'cowrie' } },
    });

    expect(callLog.some((s) => s.includes('probe_samples'))).toBe(true);
    // uptimeRatio should be 1 (only recent reachable sample counted), not 0.5
    expect(result.probePayload?.signals[0]!.uptimeRatio).toBe(1);
  });
});
