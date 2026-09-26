import { describe, it, expect } from 'vitest';
import {
  HEALTH_WEIGHTS,
  MIN_HEALTH_SAMPLES,
  computeAnchorHealth,
  probeHealthScore,
  toHealthSummary,
  type HealthSignalKey,
  type HealthSignal,
} from '@/lib/reputation/health';
import type { ProbeKind, ProbeLedgerRow } from '@/types/reputation';

const NOW = new Date('2026-09-09T12:00:00.000Z');

function row(overrides: Partial<ProbeLedgerRow> & { kind: ProbeKind }): ProbeLedgerRow {
  return {
    domain: 'ngnc.online',
    corridor: null,
    reachable: true,
    latencyMs: 120,
    failureType: null,
    error: null,
    probedAt: NOW.toISOString(),
    ...overrides,
  };
}

/** `count` rows of one kind, spread backwards one minute apart from `NOW`. */
function rows(kind: ProbeKind, count: number, reachable = true): ProbeLedgerRow[] {
  return Array.from({ length: count }, (_, i) =>
    row({
      kind,
      reachable,
      probedAt: new Date(NOW.getTime() - i * 60_000).toISOString(),
    })
  );
}

function signal(overrides: Partial<HealthSignal> = {}): HealthSignal {
  return {
    samples: 0,
    successes: 0,
    incomplete: 0,
    successRate: null,
    latencyP50Ms: null,
    latencyP95Ms: null,
    lastSampleAt: null,
    lastFailureAt: null,
    lastFailureType: null,
    ...overrides,
  };
}

function signals(partial: Partial<Record<HealthSignalKey, HealthSignal>>) {
  return {
    uptime: signal(),
    quoteAvailability: signal(),
    issuerMatch: signal(),
    tomlIntegrity: signal(),
    ...partial,
  };
}

describe('probeHealthScore', () => {
  it('renormalises the weights over only the signals that were sampled', () => {
    // Uptime is the only signal with data. Its weight is 0.4, but with nothing
    // else sampled it is the whole score — not 0.4 × 1.0 = 0.4.
    const score = probeHealthScore(
      signals({ uptime: signal({ samples: 100, successes: 100, successRate: 1 }) })
    );
    expect(score).toBe(1);
  });

  it('does not score an unsampled signal as a failure', () => {
    // The distinction this whole module exists for: a quote sweep that never
    // ran is not a quote sweep that failed.
    const neverRan = probeHealthScore(
      signals({ uptime: signal({ samples: 50, successes: 50, successRate: 1 }) })
    );
    const ranAndFailed = probeHealthScore(
      signals({
        uptime: signal({ samples: 50, successes: 50, successRate: 1 }),
        quoteAvailability: signal({ samples: 50, successes: 0, successRate: 0 }),
      })
    );

    expect(neverRan).toBe(1);
    expect(ranAndFailed).toBeLessThan(1);
    expect(ranAndFailed).toBeCloseTo(
      HEALTH_WEIGHTS.uptime / (HEALTH_WEIGHTS.uptime + HEALTH_WEIGHTS.quoteAvailability),
      10
    );
  });

  it('returns null when nothing was sampled at all', () => {
    expect(probeHealthScore(signals({}))).toBeNull();
  });

  it('weights uptime above each of the other three signals', () => {
    expect(HEALTH_WEIGHTS.uptime).toBeGreaterThan(HEALTH_WEIGHTS.quoteAvailability);
    expect(HEALTH_WEIGHTS.quoteAvailability).toBe(HEALTH_WEIGHTS.issuerMatch);
    expect(HEALTH_WEIGHTS.issuerMatch).toBe(HEALTH_WEIGHTS.tomlIntegrity);
    const total = Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('computeAnchorHealth', () => {
  const input = { anchorId: 'ngnc', domain: 'ngnc.online', now: NOW };

  it('reports an unsampled signal as null, never as zero', () => {
    const health = computeAnchorHealth(rows('uptime', 20), input);

    expect(health.signals.uptime.successRate).toBe(1);
    expect(health.signals.quoteAvailability.successRate).toBeNull();
    expect(health.signals.issuerMatch.successRate).toBeNull();
    expect(health.signals.tomlIntegrity.successRate).toBeNull();
  });

  it('withholds a score below the minimum sample count', () => {
    const health = computeAnchorHealth(rows('uptime', MIN_HEALTH_SAMPLES - 1), input);

    expect(health.state).toBe('insufficient_data');
    expect(health.healthScore).toBeNull();
    // The observations are still reported — they happened.
    expect(health.sampleSize).toBe(MIN_HEALTH_SAMPLES - 1);
    expect(health.signals.uptime.samples).toBe(MIN_HEALTH_SAMPLES - 1);
  });

  it('publishes a score at the minimum sample count', () => {
    const health = computeAnchorHealth(rows('uptime', MIN_HEALTH_SAMPLES), input);

    expect(health.state).toBe('ok');
    expect(health.healthScore).toBe(1);
  });

  it('mixes all four probe kinds into one record', () => {
    const health = computeAnchorHealth(
      [
        ...rows('uptime', 20),
        ...rows('quote', 10, false),
        ...rows('issuer-mismatch', 5),
        ...rows('toml-integrity', 5),
      ],
      input
    );

    expect(health.signals.uptime.successRate).toBe(1);
    expect(health.signals.quoteAvailability.successRate).toBe(0);
    expect(health.signals.issuerMatch.successRate).toBe(1);
    expect(health.signals.tomlIntegrity.successRate).toBe(1);
    expect(health.sampleSize).toBe(40);
    expect(health.healthScore).toBeCloseTo(1 - HEALTH_WEIGHTS.quoteAvailability, 10);
  });

  it('leaves latency null for the two kinds that are comparisons, not round trips', () => {
    const health = computeAnchorHealth(
      [...rows('uptime', 20), ...rows('issuer-mismatch', 20), ...rows('toml-integrity', 20)],
      input
    );

    expect(health.signals.uptime.latencyP50Ms).toBe(120);
    expect(health.signals.issuerMatch.latencyP50Ms).toBeNull();
    expect(health.signals.tomlIntegrity.latencyP50Ms).toBeNull();
  });

  it('excludes rows outside the window', () => {
    const old = row({
      kind: 'uptime',
      probedAt: new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const health = computeAnchorHealth([...rows('uptime', 20), old], {
      ...input,
      windowDays: 30,
    });

    expect(health.sampleSize).toBe(20);
  });

  it('records the last failure and its classification', () => {
    const health = computeAnchorHealth(
      [
        ...rows('uptime', 19),
        row({
          kind: 'uptime',
          reachable: false,
          failureType: 'timeout',
          error: 'timed out',
          probedAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
        }),
      ],
      input
    );

    expect(health.signals.uptime.samples).toBe(20);
    expect(health.signals.uptime.successes).toBe(19);
    expect(health.signals.uptime.lastFailureType).toBe('timeout');
    expect(health.signals.uptime.lastFailureAt).not.toBeNull();
  });

  it('does not report a stale run as a current streak', () => {
    // Last probed a week ago: the anchor is not on a streak now.
    const stale = Array.from({ length: 20 }, (_, i) =>
      row({
        kind: 'uptime',
        probedAt: new Date(NOW.getTime() - (7 * 24 * 60 * 60 * 1000 + i * 60_000)).toISOString(),
      })
    );

    expect(computeAnchorHealth(stale, input).continuousDays).toBe(0);
  });

  it('counts consecutive days ending today as a streak', () => {
    const threeDays = [0, 1, 2].flatMap((dayOffset) =>
      Array.from({ length: 5 }, (_, i) =>
        row({
          kind: 'uptime',
          probedAt: new Date(
            NOW.getTime() - dayOffset * 24 * 60 * 60 * 1000 - i * 60_000
          ).toISOString(),
        })
      )
    );

    const health = computeAnchorHealth(threeDays, input);
    expect(health.continuousDays).toBe(3);
    expect(health.observedDays).toBe(3);
  });

  it('returns an empty record rather than throwing when there are no probes', () => {
    const health = computeAnchorHealth([], input);

    expect(health.state).toBe('insufficient_data');
    expect(health.healthScore).toBeNull();
    expect(health.sampleSize).toBe(0);
    expect(health.continuousDays).toBe(0);
  });
});

describe('toHealthSummary', () => {
  it('flattens to the four rates the API publishes', () => {
    const health = computeAnchorHealth([...rows('uptime', 20), ...rows('quote', 10, false)], {
      anchorId: 'ngnc',
      domain: 'ngnc.online',
      now: NOW,
    });

    expect(toHealthSummary(health)).toMatchObject({
      state: 'ok',
      uptimeRate: 1,
      quoteAvailability: 0,
      issuerMatchRate: null,
      tomlIntegrityRate: null,
      probeSamples: 30,
    });
  });
});

describe('a check that could not complete is not a failure by the anchor', () => {
  const input = { anchorId: 'moneygram', domain: 'stellar.moneygram.com', now: NOW };

  function failing(kind: ProbeKind, count: number, failureType: ProbeLedgerRow['failureType']) {
    return Array.from({ length: count }, (_, i) =>
      row({
        kind,
        reachable: false,
        failureType,
        error: 'check did not complete',
        probedAt: new Date(NOW.getTime() - i * 60_000).toISOString(),
      })
    );
  }

  it('excludes an issuer check that never returned a verdict', () => {
    // This is the live MoneyGram case: 583 issuer rows, zero successes, and
    // every one of them classified `unknown` — the check never completed. It
    // has never once returned `mismatch`. Counting these as failures would
    // publish "0% issuer match" about a real company on a public page.
    const health = computeAnchorHealth(
      [...rows('uptime', 20), ...failing('issuer-mismatch', 583, 'unknown')],
      input
    );

    expect(health.signals.issuerMatch.samples).toBe(0);
    expect(health.signals.issuerMatch.incomplete).toBe(583);
    expect(health.signals.issuerMatch.successRate).toBeNull();
    // And it must not drag the score down: uptime is the only verdict here.
    expect(health.healthScore).toBe(1);
  });

  it('counts an issuer check that did return a mismatch', () => {
    const health = computeAnchorHealth(
      [...rows('uptime', 20), ...failing('issuer-mismatch', 20, 'mismatch')],
      input
    );

    expect(health.signals.issuerMatch.samples).toBe(20);
    expect(health.signals.issuerMatch.incomplete).toBe(0);
    expect(health.signals.issuerMatch.successRate).toBe(0);
    expect(health.healthScore).toBeCloseTo(
      HEALTH_WEIGHTS.uptime / (HEALTH_WEIGHTS.uptime + HEALTH_WEIGHTS.issuerMatch),
      10
    );
  });

  it('excludes a toml check that failed on transport, keeps one that failed on integrity', () => {
    const transport = computeAnchorHealth(
      [...rows('uptime', 20), ...failing('toml-integrity', 30, 'timeout')],
      input
    );
    expect(transport.signals.tomlIntegrity.samples).toBe(0);
    expect(transport.signals.tomlIntegrity.incomplete).toBe(30);
    expect(transport.signals.tomlIntegrity.successRate).toBeNull();

    const integrity = computeAnchorHealth(
      [...rows('uptime', 20), ...failing('toml-integrity', 30, 'integrity')],
      input
    );
    expect(integrity.signals.tomlIntegrity.samples).toBe(30);
    expect(integrity.signals.tomlIntegrity.successRate).toBe(0);
  });

  it('still counts every uptime failure, whatever the transport reason', () => {
    // Uptime is a liveness observation, not a comparison: a request that did
    // not come back is the answer regardless of why.
    const health = computeAnchorHealth(failing('uptime', 20, 'dns'), input);

    expect(health.signals.uptime.samples).toBe(20);
    expect(health.signals.uptime.incomplete).toBe(0);
    expect(health.signals.uptime.successRate).toBe(0);
  });

  it('does not let incomplete rows alone release a score', () => {
    const health = computeAnchorHealth(failing('issuer-mismatch', 600, 'unknown'), input);

    expect(health.sampleSize).toBe(0);
    expect(health.incompleteChecks).toBe(600);
    expect(health.state).toBe('insufficient_data');
    expect(health.healthScore).toBeNull();
  });
});
