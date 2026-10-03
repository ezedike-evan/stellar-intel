import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classify,
  mapLimit,
  parseConcurrency,
  renderRecheck,
  symptom,
} from '../scripts/anchor-survey.mjs';

describe('parseConcurrency', () => {
  it('defaults to 12', () => {
    expect(parseConcurrency([], {})).toBe(12);
  });

  it('reads the --concurrency flag (both spellings)', () => {
    expect(parseConcurrency(['--concurrency', '5'], {})).toBe(5);
    expect(parseConcurrency(['--json', '--concurrency=7'], {})).toBe(7);
  });

  it('falls back to ANCHOR_SURVEY_CONCURRENCY, with the flag taking precedence', () => {
    expect(parseConcurrency([], { ANCHOR_SURVEY_CONCURRENCY: '9' })).toBe(9);
    expect(parseConcurrency(['--concurrency', '3'], { ANCHOR_SURVEY_CONCURRENCY: '9' })).toBe(3);
  });

  it('clamps to 1-32', () => {
    expect(parseConcurrency(['--concurrency', '0'], {})).toBe(1);
    expect(parseConcurrency(['--concurrency', '-4'], {})).toBe(1);
    expect(parseConcurrency(['--concurrency', '500'], {})).toBe(32);
    expect(parseConcurrency([], { ANCHOR_SURVEY_CONCURRENCY: '64' })).toBe(32);
  });

  it('ignores unparseable values', () => {
    expect(parseConcurrency(['--concurrency', 'abc'], { ANCHOR_SURVEY_CONCURRENCY: '6' })).toBe(6);
    expect(parseConcurrency([], { ANCHOR_SURVEY_CONCURRENCY: 'nope' })).toBe(12);
  });
});

describe('mapLimit', () => {
  it('never runs more than N workers at once and preserves order', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    const out = await mapLimit(items, 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, (20 - n) % 4));
      inFlight--;
      return n * 2;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(out).toEqual(items.map((n) => n * 2));
  });
});

describe('classify', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const tomlResponse = (body) => ({ ok: true, status: 200, text: async () => body });

  it('derives sep6/sep24/sep31/sep38 flags from the TOML body', async () => {
    vi.mocked(fetch).mockResolvedValue(
      tomlResponse(
        [
          'TRANSFER_SERVER="https://a.example/sep6"',
          'TRANSFER_SERVER_SEP0024="https://a.example/sep24"',
          'DIRECT_PAYMENT_SERVER="https://a.example/sep31"',
        ].join('\n')
      )
    );

    // Every rail's /info answers with the same TOML body here; it is not JSON,
    // so each rail is recorded as a failed /info without breaking the flags.
    expect(await classify('a.example')).toMatchObject({
      domain: 'a.example',
      reachable: true,
      sep6: true,
      sep24: true,
      sep38: false,
      sep31: true,
    });
  });

  it('flags sep38 from ANCHOR_QUOTE_SERVER and does not confuse SEP-6 with SEP-24', async () => {
    vi.mocked(fetch).mockResolvedValue(
      tomlResponse('ANCHOR_QUOTE_SERVER="https://q.example"\nTRANSFER_SERVER_SEP0024="x"')
    );

    const result = await classify('q.example');
    expect(result).toMatchObject({ sep38: true, sep24: true, sep6: false, sep31: false });
  });

  it('reports HTTP 404 as unreachable', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404, text: async () => '' });

    expect(await classify('gone.example')).toEqual({
      domain: 'gone.example',
      reachable: false,
      reason: 'HTTP 404',
    });
  });

  it('waits 1000 ms before retrying a first ENOTFOUND, then succeeds', async () => {
    vi.useFakeTimers();
    const dnsError = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ENOTFOUND' },
    });
    vi.mocked(fetch)
      .mockRejectedValueOnce(dnsError)
      .mockResolvedValueOnce(tomlResponse('TRANSFER_SERVER="https://r.example"'));

    const pending = classify('r.example');
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    // One failed DNS attempt, the TOML fetch, then the SEP-6 /info probe.
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ domain: 'r.example', reachable: true, sep6: true });
  });

  it('retries other failures immediately', async () => {
    vi.useFakeTimers();
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    });
    vi.mocked(fetch)
      .mockRejectedValueOnce(refused)
      .mockResolvedValueOnce(tomlResponse('TRANSFER_SERVER="x"'));

    const result = await classify('c.example');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.reachable).toBe(true);
  });

  it('reports the failure reason when both attempts fail', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    });
    vi.mocked(fetch).mockRejectedValue(refused);

    expect(await classify('d.example')).toEqual({
      domain: 'd.example',
      reachable: false,
      reason: 'TypeError:ECONNREFUSED',
    });
  });
});

describe('symptom / renderRecheck', () => {
  it('maps known reasons and passes unknown ones through', () => {
    expect(symptom('TypeError:ENOTFOUND')).toBe('DNS does not resolve');
    expect(symptom('weird')).toBe('weird');
  });

  it('splits connect timeouts into Unreachable and the rest into Unconfirmed', () => {
    const md = renderRecheck(
      [
        { domain: 'slow.example', reason: 'TypeError:UND_ERR_CONNECT_TIMEOUT' },
        { domain: 'cowrie.exchange', reason: 'HTTP 404' },
      ],
      '2026-09-30'
    );

    expect(md).toContain('## Unreachable (1)');
    expect(md).toContain('| 1 | `slow.example` | 2026-09-30 | 2026-09-30 |  |');
    expect(md).toContain('## Unconfirmed (1)');
    expect(md).toContain('`cowrie.exchange` | HTTP 404 (no toml)');
  });
});
