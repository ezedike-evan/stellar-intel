import { describe, it, expect } from 'vitest';
import {
  InMemoryProbeStore,
  probeAnchor,
  runProbe,
  reachabilityScore,
  averageLatencyMs,
  type TomlProbeResult,
} from '@/lib/reputation/probe';

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
});
