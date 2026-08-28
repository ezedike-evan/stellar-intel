import { describe, it, expect, vi } from 'vitest';
import {
  AnchorHealthTracker,
  failingDimensions,
  InMemoryProbeStore,
  probeAnchor,
  runProbe,
  reachabilityScore,
  averageLatencyMs,
  classifyFailure,
  InMemoryDriftStore,
  detectQuoteDrift,
  probeQuoteDrift,
  probeQuoteLatency,
  probeAllAnchorQuotes,
  quoteLatencyPercentiles,
  probeIssuerMismatch,
  probeAllAnchorIssuers,
  probeTomlIntegrity,
  probeAllAnchorIntegrity,
  DurableProbeStore,
  type TomlProbeResult,
  type AnchorQuote,
  type RateProbeResult,
  type QuoteProbeResult,
  type IssuerCheckResult,
  type ProbeLedgerSink,
  type DriftSample,
  type HealthAlert,
  type ProbeSample,
} from '@/lib/reputation/probe';
import { healthStatusFor, isDegradingTransition } from '@/lib/reputation/thresholds';
import type { Anchor, Sep1TomlData } from '@/types';
import type { ProbeLedgerRow } from '@/types/reputation';
import type { TomlResult } from '@/lib/stellar/sep1';

/** Deterministic clock: returns `start`, then advances by `step` each call. */
function steppingClock(start = 1000, step = 120): () => number {
  let t = start;
  return () => {
    const value = t;
    t += step;
    return value;
  };
}

const ok = async (): Promise<TomlProbeResult> => ({ ok: true });
const down = async (): Promise<TomlProbeResult> => ({ ok: false, error: 'HTTP 521' });
const throws = async (): Promise<TomlProbeResult> => {
  throw new Error('ENOTFOUND');
};

describe('reputation probe', () => {
  it('records a reachable sample with measured latency', async () => {
    const store = new InMemoryProbeStore();
    const sample = await probeAnchor('up.example', store, {
      fetchToml: ok,
      now: steppingClock(1000, 120),
    });

    expect(sample.reachable).toBe(true);
    expect(sample.latencyMs).toBe(120);
    expect(sample.at).toBe(1120);
    expect(store.samples('up.example')).toHaveLength(1);
  });

  it('records an unreachable sample when the toml fetch fails', async () => {
    const store = new InMemoryProbeStore();
    const sample = await probeAnchor('down.example', store, { fetchToml: down });

    expect(sample.reachable).toBe(false);
    expect(sample.error).toBe('HTTP 521');
    expect(store.samples('down.example')).toHaveLength(1);
  });

  it('records unreachable (does not throw) when the fetch helper throws', async () => {
    const store = new InMemoryProbeStore();
    const sample = await probeAnchor('dns-fail.example', store, { fetchToml: throws });

    expect(sample.reachable).toBe(false);
    expect(sample.error).toContain('ENOTFOUND');
  });

  it('runProbe writes one sample per anchor', async () => {
    const store = new InMemoryProbeStore();
    const samples = await runProbe(['a.example', 'b.example'], store, { fetchToml: ok });

    expect(samples).toHaveLength(2);
    expect(store.samples()).toHaveLength(2);
    expect(store.samples('a.example')).toHaveLength(1);
  });

  it('scores a fully-down anchor below a fully-up one', async () => {
    const store = new InMemoryProbeStore();
    await probeAnchor('up.example', store, { fetchToml: ok });
    await probeAnchor('down.example', store, { fetchToml: down });

    expect(reachabilityScore('up.example', store)).toBe(1);
    expect(reachabilityScore('down.example', store)).toBe(0);
    expect(reachabilityScore('down.example', store)!).toBeLessThan(
      reachabilityScore('up.example', store)!
    );
  });

  it('a down probe lowers an anchor reachability score', async () => {
    const store = new InMemoryProbeStore();
    let healthy = true;
    const fetchToml = async (): Promise<TomlProbeResult> =>
      healthy ? { ok: true } : { ok: false, error: 'origin down' };

    // Three healthy probes -> perfect score.
    await probeAnchor('anchor.example', store, { fetchToml });
    await probeAnchor('anchor.example', store, { fetchToml });
    await probeAnchor('anchor.example', store, { fetchToml });
    const before = reachabilityScore('anchor.example', store)!;
    expect(before).toBe(1);

    // The anchor goes down: one failed probe drops the score.
    healthy = false;
    await probeAnchor('anchor.example', store, { fetchToml });
    const after = reachabilityScore('anchor.example', store)!;

    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(0.75, 5);
  });

  it('averages latency over reachable samples only', async () => {
    const store = new InMemoryProbeStore();
    // Two reachable probes at 120ms each via the stepping clock.
    const now = steppingClock(0, 120);
    await probeAnchor('a.example', store, { fetchToml: ok, now });
    await probeAnchor('a.example', store, { fetchToml: ok, now });
    // An unreachable probe must not pollute the latency average.
    await probeAnchor('a.example', store, { fetchToml: down, now });

    expect(averageLatencyMs('a.example', store)).toBe(120);
  });

  it('returns null reachability when an anchor has no samples', () => {
    const store = new InMemoryProbeStore();
    expect(reachabilityScore('unknown.example', store)).toBeNull();
    expect(averageLatencyMs('unknown.example', store)).toBeNull();
  });

  it('classifies DNS failures', () => {
    expect(classifyFailure('getaddrinfo ENOTFOUND example.com')).toBe('dns');
    expect(classifyFailure('ENOTINFO lookup failed')).toBe('dns');
    expect(classifyFailure('EAI_AGAIN temporary failure')).toBe('dns');
  });

  it('classifies TLS failures', () => {
    expect(classifyFailure('UNABLE_TO_VERIFY_LEAF_SIGNATURE')).toBe('tls');
    expect(classifyFailure('self signed certificate in chain')).toBe('tls');
    expect(classifyFailure('ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION')).toBe('tls');
  });

  it('classifies timeout failures', () => {
    expect(classifyFailure('The operation was aborted')).toBe('timeout');
    expect(classifyFailure('connect ETIMEDOUT 1.2.3.4:443')).toBe('timeout');
    expect(classifyFailure('request timeout after 5000ms')).toBe('timeout');
  });

  it('classifies HTTP failures', () => {
    expect(classifyFailure('HTTP 521 origin down')).toBe('http');
    expect(classifyFailure('request failed with status 500')).toBe('http');
  });

  it('classifies unknown failures', () => {
    expect(classifyFailure('something weird happened')).toBe('unknown');
  });

  it('records failureType on unreachable samples', async () => {
    const store = new InMemoryProbeStore();
    const dnsFail = async (): Promise<TomlProbeResult> => {
      throw new Error('getaddrinfo ENOTFOUND example.com');
    };
    const sample = await probeAnchor('dns-fail.example', store, { fetchToml: dnsFail });

    expect(sample.reachable).toBe(false);
    expect(sample.failureType).toBe('dns');
  });

  it('records null failureType on reachable samples', async () => {
    const store = new InMemoryProbeStore();
    const sample = await probeAnchor('up.example', store, { fetchToml: ok });

    expect(sample.reachable).toBe(true);
    expect(sample.failureType).toBeNull();
  });
});

function testAnchor(over: Partial<Anchor> = {}): Anchor {
  return {
    id: 'test-anchor',
    name: 'Test Anchor',
    homeDomain: 'anchor.example',
    corridors: ['usdc-ngn'],
    assetCode: 'USDC',
    assetIssuer: 'GISSUER',
    seps: ['sep10', 'sep38'],
    ...over,
  };
}

describe('quote-drift probe', () => {
  it('flags a fixture anchor quoting 10% off-median; others within threshold are not', () => {
    const quotes: AnchorQuote[] = [
      { anchorId: 'a', rate: 1500 },
      { anchorId: 'b', rate: 1500 },
      { anchorId: 'c', rate: 1500 },
      { anchorId: 'drifted', rate: 1650 }, // 10% above median
    ];

    const samples = detectQuoteDrift(quotes, 'usdc-ngn');
    const drifted = samples.find((s) => s.anchorId === 'drifted')!;
    const notDrifted = samples.filter((s) => s.anchorId !== 'drifted');

    expect(drifted.flagged).toBe(true);
    expect(drifted.deviationPercent).toBeCloseTo(10, 5);
    expect(drifted.medianRate).toBe(1500);
    for (const sample of notDrifted) {
      expect(sample.flagged).toBe(false);
      expect(sample.deviationPercent).toBeCloseTo(0, 5);
    }
  });

  it('does not flag a quote within the configured threshold', () => {
    const quotes: AnchorQuote[] = [
      { anchorId: 'a', rate: 1000 },
      { anchorId: 'b', rate: 1000 },
      { anchorId: 'close', rate: 1020 }, // 2% above median, default threshold is 3%
    ];

    const samples = detectQuoteDrift(quotes, 'usdc-ngn');
    const close = samples.find((s) => s.anchorId === 'close')!;

    expect(close.flagged).toBe(false);
    expect(close.deviationPercent).toBeCloseTo(2, 5);
  });

  it('honors a custom threshold', () => {
    const quotes: AnchorQuote[] = [
      { anchorId: 'a', rate: 100 },
      { anchorId: 'b', rate: 100 },
      { anchorId: 'c', rate: 104 }, // 4% above median
    ];

    expect(detectQuoteDrift(quotes, 'usdc-ngn', 5).find((s) => s.anchorId === 'c')!.flagged).toBe(
      false
    );
    expect(detectQuoteDrift(quotes, 'usdc-ngn', 3).find((s) => s.anchorId === 'c')!.flagged).toBe(
      true
    );
  });

  it('flags a quote below the median the same as one above it', () => {
    const quotes: AnchorQuote[] = [
      { anchorId: 'a', rate: 1000 },
      { anchorId: 'b', rate: 1000 },
      { anchorId: 'low', rate: 850 }, // 15% below median
    ];

    const low = detectQuoteDrift(quotes, 'usdc-ngn').find((s) => s.anchorId === 'low')!;
    expect(low.flagged).toBe(true);
    expect(low.deviationPercent).toBeCloseTo(-15, 5);
  });

  it('probeQuoteDrift fetches every anchor, records samples, and never excludes a flagged anchor', async () => {
    const store = new InMemoryDriftStore();
    const anchors = [
      testAnchor({ id: 'a' }),
      testAnchor({ id: 'b' }),
      testAnchor({ id: 'c' }),
      testAnchor({ id: 'drifted' }),
    ];
    const rates: Record<string, number> = { a: 1500, b: 1500, c: 1500, drifted: 1650 };
    const fetchRate = async (anchor: Anchor): Promise<RateProbeResult> => ({
      ok: true,
      rate: rates[anchor.id]!,
    });

    const samples = await probeQuoteDrift(anchors, 'usdc-ngn', '100', store, { fetchRate });

    expect(samples).toHaveLength(4);
    expect(store.samples()).toHaveLength(4);
    const drifted = samples.find((s) => s.anchorId === 'drifted')!;
    expect(drifted.flagged).toBe(true);
    // Flagging never removes the anchor from the recorded comparison set.
    expect(store.samples('drifted')).toHaveLength(1);
  });

  it('skips unreachable anchors from the median/comparison and does not record them', async () => {
    const store = new InMemoryDriftStore();
    const anchors = [testAnchor({ id: 'a' }), testAnchor({ id: 'down' }), testAnchor({ id: 'b' })];
    const fetchRate = async (anchor: Anchor): Promise<RateProbeResult> =>
      anchor.id === 'down' ? { ok: false, error: 'HTTP 521' } : { ok: true, rate: 1500 };

    const samples = await probeQuoteDrift(anchors, 'usdc-ngn', '100', store, { fetchRate });

    expect(samples).toHaveLength(2);
    expect(samples.find((s) => s.anchorId === 'down')).toBeUndefined();
  });

  it('returns an empty result set when no anchor produces a usable quote', async () => {
    const store = new InMemoryDriftStore();
    const anchors = [testAnchor({ id: 'a' })];
    const fetchRate = async (): Promise<RateProbeResult> => ({ ok: false, error: 'timeout' });

    const samples = await probeQuoteDrift(anchors, 'usdc-ngn', '100', store, { fetchRate });

    expect(samples).toHaveLength(0);
    expect(store.samples()).toHaveLength(0);
  });
});

const quoteOk = async (): Promise<QuoteProbeResult> => ({ ok: true });
const quoteDown = async (): Promise<QuoteProbeResult> => ({ ok: false, error: 'HTTP 503' });

describe('quote-latency probe', () => {
  it('records a reachable quote sample with measured latency and corridor', async () => {
    const store = new InMemoryProbeStore();
    const anchor = testAnchor();
    const sample = await probeQuoteLatency(anchor, 'usdc-ngn', store, {
      fetchQuote: quoteOk,
      now: steppingClock(1000, 80),
    });

    expect(sample.reachable).toBe(true);
    expect(sample.latencyMs).toBe(80);
    expect(sample.corridor).toBe('usdc-ngn');
    expect(sample.domain).toBe('anchor.example');
    expect(store.samples('anchor.example')).toHaveLength(1);
  });

  it('records an unreachable quote sample when the quote fetch fails', async () => {
    const store = new InMemoryProbeStore();
    const sample = await probeQuoteLatency(testAnchor(), 'usdc-ngn', store, {
      fetchQuote: quoteDown,
    });

    expect(sample.reachable).toBe(false);
    expect(sample.error).toBe('HTTP 503');
    expect(sample.failureType).toBe('http');
  });

  it('records unreachable (does not throw) when the quote fetcher throws', async () => {
    const store = new InMemoryProbeStore();
    const throwsQuote = async (): Promise<QuoteProbeResult> => {
      throw new Error('The operation was aborted');
    };
    const sample = await probeQuoteLatency(testAnchor(), 'usdc-ngn', store, {
      fetchQuote: throwsQuote,
    });

    expect(sample.reachable).toBe(false);
    expect(sample.failureType).toBe('timeout');
  });

  it('probeAllAnchorQuotes probes every anchor+corridor pair concurrently', async () => {
    const store = new InMemoryProbeStore();
    const anchors = [
      testAnchor({ id: 'a', homeDomain: 'a.example', corridors: ['usdc-ngn', 'usdc-kes'] }),
      testAnchor({ id: 'b', homeDomain: 'b.example', corridors: ['usdc-ars'] }),
    ];
    const samples = await probeAllAnchorQuotes(store, { fetchQuote: quoteOk }, anchors);

    expect(samples).toHaveLength(3);
    expect(store.samples('a.example')).toHaveLength(2);
    expect(store.samples('b.example')).toHaveLength(1);
  });

  it('computes p50/p95 latency over a rolling window for one anchor+corridor', async () => {
    const store = new InMemoryProbeStore();
    const anchor = testAnchor();
    const latencies = [100, 200, 300, 400, 500];
    for (const latency of latencies) {
      await probeQuoteLatency(anchor, 'usdc-ngn', store, {
        fetchQuote: quoteOk,
        now: steppingClock(0, latency),
      });
    }

    const stats = quoteLatencyPercentiles('anchor.example', 'usdc-ngn', store);
    expect(stats).not.toBeNull();
    expect(stats!.sampleCount).toBe(5);
    expect(stats!.p50Ms).toBe(300);
    expect(stats!.p95Ms).toBe(500);
  });

  it('excludes unreachable samples and other corridors from percentiles', async () => {
    const store = new InMemoryProbeStore();
    const anchor = testAnchor({ corridors: ['usdc-ngn', 'usdc-kes'] });
    await probeQuoteLatency(anchor, 'usdc-ngn', store, {
      fetchQuote: quoteOk,
      now: steppingClock(0, 100),
    });
    await probeQuoteLatency(anchor, 'usdc-ngn', store, {
      fetchQuote: quoteDown,
      now: steppingClock(0, 9000),
    });
    await probeQuoteLatency(anchor, 'usdc-kes', store, {
      fetchQuote: quoteOk,
      now: steppingClock(0, 5000),
    });

    const stats = quoteLatencyPercentiles('anchor.example', 'usdc-ngn', store);
    expect(stats!.sampleCount).toBe(1);
    expect(stats!.p50Ms).toBe(100);
  });

  it('honors a configurable rolling window size', async () => {
    const store = new InMemoryProbeStore();
    const anchor = testAnchor();
    for (const latency of [100, 100, 100, 900, 900]) {
      await probeQuoteLatency(anchor, 'usdc-ngn', store, {
        fetchQuote: quoteOk,
        now: steppingClock(0, latency),
      });
    }

    // Full history includes the three fast samples; a window of 2 keeps only
    // the most recent (slow) pair.
    const full = quoteLatencyPercentiles('anchor.example', 'usdc-ngn', store);
    const windowed = quoteLatencyPercentiles('anchor.example', 'usdc-ngn', store, 2);

    expect(full!.sampleCount).toBe(5);
    expect(windowed!.sampleCount).toBe(2);
    expect(windowed!.p50Ms).toBe(900);
  });

  it('returns null when an anchor+corridor has no reachable quote samples', () => {
    const store = new InMemoryProbeStore();
    expect(quoteLatencyPercentiles('unknown.example', 'usdc-ngn', store)).toBeNull();
  });
});

const issuerMatching = async (): Promise<IssuerCheckResult> => ({
  ok: true,
  advertisedIssuer: 'GADVERTISED',
  actualIssuer: 'GADVERTISED',
});
const issuerMismatched = async (): Promise<IssuerCheckResult> => ({
  ok: true,
  advertisedIssuer: 'GADVERTISED',
  actualIssuer: 'GIMPOSTOR',
});
const issuerUnreachable = async (): Promise<IssuerCheckResult> => ({
  ok: false,
  advertisedIssuer: null,
  actualIssuer: null,
  error: 'HTTP 503',
});

describe('issuer-mismatch probe', () => {
  it('records reachable=true when the advertised and actual issuer match', async () => {
    const store = new InMemoryProbeStore();
    const sample = await probeIssuerMismatch(testAnchor(), store, { checkIssuer: issuerMatching });

    expect(sample.reachable).toBe(true);
    expect(sample.failureType ?? null).toBeNull();
    expect(sample.error).toBeUndefined();
  });

  it('flags a mismatch with a distinct failure type and a descriptive error', async () => {
    const store = new InMemoryProbeStore();
    const anchor = testAnchor({ assetCode: 'USDC' });
    const sample = await probeIssuerMismatch(anchor, store, { checkIssuer: issuerMismatched });

    expect(sample.reachable).toBe(false);
    expect(sample.failureType).toBe('mismatch');
    expect(sample.error).toContain('GADVERTISED');
    expect(sample.error).toContain('GIMPOSTOR');
  });

  it('classifies a genuine probe failure like the other probes, not as a mismatch', async () => {
    const store = new InMemoryProbeStore();
    const sample = await probeIssuerMismatch(testAnchor(), store, {
      checkIssuer: issuerUnreachable,
    });

    expect(sample.reachable).toBe(false);
    expect(sample.failureType).toBe('http');
    expect(sample.error).toBe('HTTP 503');
  });

  it('records unreachable (does not throw) when the check helper throws', async () => {
    const store = new InMemoryProbeStore();
    const throwsCheck = async (): Promise<IssuerCheckResult> => {
      throw new Error('ENOTFOUND');
    };
    const sample = await probeIssuerMismatch(testAnchor(), store, { checkIssuer: throwsCheck });

    expect(sample.reachable).toBe(false);
    expect(sample.error).toContain('ENOTFOUND');
  });

  it('probeAllAnchorIssuers checks every anchor concurrently', async () => {
    const store = new InMemoryProbeStore();
    const anchors = [
      testAnchor({ id: 'a', homeDomain: 'a.example' }),
      testAnchor({ id: 'b', homeDomain: 'b.example' }),
    ];
    const samples = await probeAllAnchorIssuers(store, { checkIssuer: issuerMatching }, anchors);

    expect(samples).toHaveLength(2);
    expect(store.samples('a.example')).toHaveLength(1);
    expect(store.samples('b.example')).toHaveLength(1);
  });
});

function tomlData(over: Partial<Sep1TomlData> = {}): Sep1TomlData {
  return {
    domain: 'anchor.example',
    TRANSFER_SERVER_SEP0024: 'https://anchor.example/sep24',
    TRANSFER_SERVER: null,
    DIRECT_PAYMENT_SERVER: null,
    ANCHOR_QUOTE_SERVER: null,
    WEB_AUTH_ENDPOINT: null,
    SIGNING_KEY: 'GABCDEF',
    NETWORK_PASSPHRASE: null,
    ORG_URL: null,
    ORG_SUPPORT_EMAIL: null,
    ORG_SUPPORT_URL: null,
    CURRENCIES: [{ code: 'USDC', issuer: 'GISSUER' }],
    capabilities: { sep10: false, sep24: true, sep38: false, sep12: true },
    ...over,
  };
}

const tomlValid = async (): Promise<TomlResult> => ({ ok: true, data: tomlData() });
const tomlUnreachable = async (): Promise<TomlResult> => ({ ok: false, error: 'HTTP 503' });

describe('toml-integrity probe', () => {
  it('records reachable=true and remembers the snapshot when the toml validates clean', async () => {
    const store = new InMemoryProbeStore();
    const remembered: Sep1TomlData[] = [];
    const sample = await probeTomlIntegrity('anchor.example', store, {
      fetchToml: tomlValid,
      getLastKnownGood: () => null,
      recordLastKnownGood: (_domain, toml) => remembered.push(toml),
    });

    expect(sample.reachable).toBe(true);
    expect(sample.failureType ?? null).toBeNull();
    expect(remembered).toHaveLength(1);
  });

  it('flags a missing SIGNING_KEY with the integrity failure type', async () => {
    const store = new InMemoryProbeStore();
    const fetchToml = async (): Promise<TomlResult> => ({
      ok: true,
      data: tomlData({ SIGNING_KEY: null }),
    });
    const sample = await probeTomlIntegrity('anchor.example', store, {
      fetchToml,
      getLastKnownGood: () => null,
    });

    expect(sample.reachable).toBe(false);
    expect(sample.failureType).toBe('integrity');
    expect(sample.error).toContain('SIGNING_KEY');
  });

  it('does not overwrite the last known-good snapshot on a failed validation', async () => {
    const store = new InMemoryProbeStore();
    const recordLastKnownGood = vi.fn();
    const fetchToml = async (): Promise<TomlResult> => ({
      ok: true,
      data: tomlData({ SIGNING_KEY: null }),
    });
    await probeTomlIntegrity('anchor.example', store, {
      fetchToml,
      getLastKnownGood: () => null,
      recordLastKnownGood,
    });

    expect(recordLastKnownGood).not.toHaveBeenCalled();
  });

  it('classifies a genuine probe failure like the other probes, not as integrity', async () => {
    const store = new InMemoryProbeStore();
    const sample = await probeTomlIntegrity('anchor.example', store, {
      fetchToml: tomlUnreachable,
    });

    expect(sample.reachable).toBe(false);
    expect(sample.failureType).toBe('http');
    expect(sample.error).toBe('HTTP 503');
  });

  it('probeAllAnchorIntegrity checks every anchor concurrently', async () => {
    const store = new InMemoryProbeStore();
    const anchors = [
      testAnchor({ id: 'a', homeDomain: 'a.example' }),
      testAnchor({ id: 'b', homeDomain: 'b.example' }),
    ];
    const samples = await probeAllAnchorIntegrity(
      store,
      { fetchToml: tomlValid, getLastKnownGood: () => null },
      anchors
    );

    expect(samples).toHaveLength(2);
    expect(store.samples('a.example')).toHaveLength(1);
    expect(store.samples('b.example')).toHaveLength(1);
  });
});

describe('DurableProbeStore', () => {
  function fakeSink(): ProbeLedgerSink & { rows: ProbeLedgerRow[] } {
    const rows: ProbeLedgerRow[] = [];
    return {
      rows,
      async recordProbeSample(row) {
        rows.push(row);
      },
    };
  }

  it('tags every recorded sample with its fixed kind and persists to the sink', async () => {
    const sink = fakeSink();
    const store = new DurableProbeStore(sink, 'uptime');

    await probeAnchor('up.example', store, { fetchToml: ok, now: steppingClock(1000, 50) });
    await store.drain();

    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0]).toMatchObject({
      domain: 'up.example',
      kind: 'uptime',
      corridor: null,
      reachable: true,
    });
  });

  it('persists quote-latency samples under the quote kind, with the corridor preserved', async () => {
    const sink = fakeSink();
    const store = new DurableProbeStore(sink, 'quote');

    await probeQuoteLatency(testAnchor(), 'usdc-ngn', store, { fetchQuote: quoteOk });
    await store.drain();

    expect(sink.rows[0]).toMatchObject({ kind: 'quote', corridor: 'usdc-ngn' });
  });

  it('persists issuer-mismatch samples under their own kind', async () => {
    const sink = fakeSink();
    const store = new DurableProbeStore(sink, 'issuer-mismatch');

    await probeIssuerMismatch(testAnchor(), store, { checkIssuer: issuerMismatched });
    await store.drain();

    expect(sink.rows[0]).toMatchObject({ kind: 'issuer-mismatch', failureType: 'mismatch' });
  });

  it('persists toml-integrity samples under their own kind', async () => {
    const sink = fakeSink();
    const store = new DurableProbeStore(sink, 'toml-integrity');
    const fetchToml = async (): Promise<TomlResult> => ({
      ok: true,
      data: tomlData({ SIGNING_KEY: null }),
    });

    await probeTomlIntegrity('anchor.example', store, { fetchToml, getLastKnownGood: () => null });
    await store.drain();

    expect(sink.rows[0]).toMatchObject({ kind: 'toml-integrity', failureType: 'integrity' });
  });

  it('does not throw when the sink fails to persist a sample', async () => {
    const failingSink: ProbeLedgerSink = {
      async recordProbeSample() {
        throw new Error('db unavailable');
      },
    };
    const store = new DurableProbeStore(failingSink, 'uptime');

    await probeAnchor('up.example', store, { fetchToml: ok });
    await expect(store.drain()).resolves.toBeUndefined();
  });
});

describe('probe-failure alerting', () => {
  const upSample = (latencyMs = 100): ProbeSample => ({
    domain: 'anchor.example',
    reachable: true,
    latencyMs,
    at: 0,
    failureType: null,
  });
  const downSample = (): ProbeSample => ({
    domain: 'anchor.example',
    reachable: false,
    latencyMs: 0,
    at: 0,
    failureType: 'timeout',
    error: 'ETIMEDOUT',
  });
  const driftSample = (flagged: boolean): DriftSample => ({
    anchorId: 'anchor-1',
    corridor: 'usdc-ngn',
    rate: 1,
    medianRate: 1,
    deviationPercent: flagged ? 10 : 0,
    flagged,
    at: 0,
  });

  describe('health thresholds', () => {
    it('latches degraded then down as the failure streak grows', () => {
      expect(healthStatusFor(0, 3, 6)).toBe('healthy');
      expect(healthStatusFor(2, 3, 6)).toBe('healthy');
      expect(healthStatusFor(3, 3, 6)).toBe('degraded');
      expect(healthStatusFor(5, 3, 6)).toBe('degraded');
      expect(healthStatusFor(6, 3, 6)).toBe('down');
    });

    it('never makes down easier to reach than degraded when misconfigured', () => {
      expect(healthStatusFor(2, 3, 1)).toBe('healthy');
      expect(healthStatusFor(3, 3, 1)).toBe('down');
    });

    it('treats only worsening transitions as alertable', () => {
      expect(isDegradingTransition('healthy', 'degraded')).toBe(true);
      expect(isDegradingTransition('healthy', 'down')).toBe(true);
      expect(isDegradingTransition('degraded', 'down')).toBe(true);
      expect(isDegradingTransition('degraded', 'degraded')).toBe(false);
      expect(isDegradingTransition('down', 'degraded')).toBe(false);
      expect(isDegradingTransition('degraded', 'healthy')).toBe(false);
    });
  });

  describe('failingDimensions', () => {
    it('reports no failures for an all-clear cycle', () => {
      expect(
        failingDimensions(
          { uptime: upSample(), latency: [upSample()], drift: driftSample(false) },
          5000
        )
      ).toEqual([]);
    });

    it('flags uptime when the toml probe was unreachable', () => {
      expect(failingDimensions({ uptime: downSample() }, 5000)).toEqual(['uptime']);
    });

    it('flags latency for a reachable but over-budget quote', () => {
      expect(failingDimensions({ latency: [upSample(9000)] }, 5000)).toEqual(['latency']);
      expect(failingDimensions({ latency: [upSample(4999)] }, 5000)).toEqual([]);
    });

    it('flags drift only when the quote was flagged off-median', () => {
      expect(failingDimensions({ drift: driftSample(true) }, 5000)).toEqual(['drift']);
      expect(failingDimensions({ drift: driftSample(false) }, 5000)).toEqual([]);
    });

    it('returns every failing dimension in a stable order', () => {
      expect(
        failingDimensions(
          { drift: driftSample(true), latency: [upSample(9000)], uptime: downSample() },
          5000
        )
      ).toEqual(['uptime', 'latency', 'drift']);
    });

    it('ignores dimensions the cycle never probed', () => {
      expect(failingDimensions({}, 5000)).toEqual([]);
    });
  });

  describe('AnchorHealthTracker', () => {
    // Acceptance criteria (#D016): a simulated run of consecutive failures
    // crosses the debounce threshold and triggers exactly one alert naming the
    // failing dimension.
    it('alerts exactly once, on the cycle that crosses the debounce threshold', async () => {
      const onAlert = vi.fn();
      const tracker = new AnchorHealthTracker({
        degradeAfter: 3,
        downAfter: 99,
        onAlert,
        now: () => 5000,
      });

      const alerts: (HealthAlert | null)[] = [];
      for (let i = 0; i < 5; i++) {
        alerts.push(await tracker.observe('anchor-1', { uptime: downSample() }));
      }

      // First two failures are debounced; the third crosses the threshold.
      expect(alerts[0]).toBeNull();
      expect(alerts[1]).toBeNull();
      expect(alerts[2]).not.toBeNull();
      // Further failures at the same status stay silent.
      expect(alerts[3]).toBeNull();
      expect(alerts[4]).toBeNull();

      expect(onAlert).toHaveBeenCalledTimes(1);
      expect(onAlert).toHaveBeenCalledWith({
        anchorId: 'anchor-1',
        from: 'healthy',
        to: 'degraded',
        dimensions: ['uptime'],
        consecutiveFailures: 3,
        at: 5000,
      });
    });

    it('does not alert on a single flaky cycle surrounded by healthy ones', async () => {
      const onAlert = vi.fn();
      const tracker = new AnchorHealthTracker({ degradeAfter: 3, onAlert });

      for (const failing of [false, true, false, true, false, true, false]) {
        await tracker.observe('anchor-1', { uptime: failing ? downSample() : upSample() });
      }

      expect(onAlert).not.toHaveBeenCalled();
      expect(tracker.statusOf('anchor-1')).toEqual({
        status: 'healthy',
        consecutiveFailures: 0,
        dimensions: [],
      });
    });

    it('names every dimension that failed during the streak', async () => {
      const onAlert = vi.fn();
      const tracker = new AnchorHealthTracker({
        degradeAfter: 3,
        latencyBudgetMs: 5000,
        onAlert,
      });

      await tracker.observe('anchor-1', { uptime: downSample() });
      await tracker.observe('anchor-1', { latency: [upSample(9000)] });
      const alert = await tracker.observe('anchor-1', { drift: driftSample(true) });

      expect(alert?.dimensions).toEqual(['uptime', 'latency', 'drift']);
      expect(onAlert).toHaveBeenCalledTimes(1);
    });

    it('escalates degraded to down with a second alert', async () => {
      const onAlert = vi.fn();
      const tracker = new AnchorHealthTracker({ degradeAfter: 2, downAfter: 4, onAlert });

      const results: (HealthAlert | null)[] = [];
      for (let i = 0; i < 5; i++) {
        results.push(await tracker.observe('anchor-1', { uptime: downSample() }));
      }

      expect(results.map((r) => r?.to ?? null)).toEqual([null, 'degraded', null, 'down', null]);
      expect(onAlert).toHaveBeenCalledTimes(2);
      expect(onAlert).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: 'degraded', to: 'down', consecutiveFailures: 4 })
      );
    });

    it('resets the streak and dimensions on recovery, without alerting', async () => {
      const onAlert = vi.fn();
      const tracker = new AnchorHealthTracker({ degradeAfter: 2, onAlert });

      await tracker.observe('anchor-1', { uptime: downSample() });
      await tracker.observe('anchor-1', { uptime: downSample() });
      expect(tracker.statusOf('anchor-1').status).toBe('degraded');

      await tracker.observe('anchor-1', { uptime: upSample() });
      expect(tracker.statusOf('anchor-1')).toEqual({
        status: 'healthy',
        consecutiveFailures: 0,
        dimensions: [],
      });
      // Only the degradation alerted; recovery did not.
      expect(onAlert).toHaveBeenCalledTimes(1);

      // A fresh streak alerts again once it re-crosses the threshold.
      await tracker.observe('anchor-1', { drift: driftSample(true) });
      const realert = await tracker.observe('anchor-1', { drift: driftSample(true) });
      expect(realert?.dimensions).toEqual(['drift']);
      expect(onAlert).toHaveBeenCalledTimes(2);
    });

    it('tracks each anchor independently', async () => {
      const onAlert = vi.fn();
      const tracker = new AnchorHealthTracker({ degradeAfter: 2, onAlert });

      await tracker.observe('anchor-1', { uptime: downSample() });
      await tracker.observe('anchor-2', { uptime: upSample() });
      await tracker.observe('anchor-1', { uptime: downSample() });
      await tracker.observe('anchor-2', { uptime: upSample() });

      expect(onAlert).toHaveBeenCalledTimes(1);
      expect(onAlert).toHaveBeenCalledWith(expect.objectContaining({ anchorId: 'anchor-1' }));
      expect(tracker.snapshot()).toEqual({
        'anchor-1': { status: 'degraded', consecutiveFailures: 2, dimensions: ['uptime'] },
        'anchor-2': { status: 'healthy', consecutiveFailures: 0, dimensions: [] },
      });
    });

    it('reports an untracked anchor as healthy', () => {
      const tracker = new AnchorHealthTracker();
      expect(tracker.statusOf('never-probed')).toEqual({
        status: 'healthy',
        consecutiveFailures: 0,
        dimensions: [],
      });
      expect(tracker.snapshot()).toEqual({});
    });

    it('awaits an async alert hook before returning', async () => {
      const seen: string[] = [];
      const tracker = new AnchorHealthTracker({
        degradeAfter: 1,
        onAlert: async () => {
          await Promise.resolve();
          seen.push('hook');
        },
      });

      await tracker.observe('anchor-1', { uptime: downSample() });
      seen.push('after');

      expect(seen).toEqual(['hook', 'after']);
    });

    it('accepts pre-computed failing dimensions', async () => {
      const onAlert = vi.fn();
      const tracker = new AnchorHealthTracker({ degradeAfter: 1, onAlert });

      const alert = await tracker.observeFailures('anchor-1', ['drift']);

      expect(alert).toMatchObject({ to: 'degraded', dimensions: ['drift'] });
      expect(onAlert).toHaveBeenCalledTimes(1);
    });
  });
});
