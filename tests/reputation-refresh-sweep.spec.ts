/**
 * Probe sweep wiring for `POST /api/reputation/refresh`.
 *
 * `runProbeSweep` is not exported, so it is exercised through the route with
 * every collaborator mocked: cron auth, the durable-store guard, the lock, the
 * reputation store and each `probeAll*` runner. The assertions are about
 * wiring — which sink each runner receives and what the response counts say —
 * not about the probes themselves, which have their own specs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkCronAuth: vi.fn(),
  checkDurableStore: vi.fn(),
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  getReputationStore: vi.fn(),
  probeAllAnchors: vi.fn(),
  probeAllAnchorQuotes: vi.fn(),
  probeAllAnchorIssuers: vi.fn(),
  probeAllAnchorIntegrity: vi.fn(),
  probeAllAnchorSep31: vi.fn(),
}));

vi.mock('@/lib/api/cron-auth', () => ({ checkCronAuth: mocks.checkCronAuth }));
vi.mock('@/lib/api/store-guard', () => ({ checkDurableStore: mocks.checkDurableStore }));
vi.mock('@/lib/reputation/lock', () => ({
  acquireLock: mocks.acquireLock,
  releaseLock: mocks.releaseLock,
}));
vi.mock('@/lib/reputation/store', () => ({ getReputationStore: mocks.getReputationStore }));
vi.mock('@/lib/reputation/probe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reputation/probe')>();
  return {
    ...actual,
    probeAllAnchors: mocks.probeAllAnchors,
    probeAllAnchorQuotes: mocks.probeAllAnchorQuotes,
    probeAllAnchorIssuers: mocks.probeAllAnchorIssuers,
    probeAllAnchorIntegrity: mocks.probeAllAnchorIntegrity,
    probeAllAnchorSep31: mocks.probeAllAnchorSep31,
  };
});

import { POST } from '@/app/api/reputation/refresh/route';
import { DurableProbeStore } from '@/lib/reputation/probe';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/reputation/refresh', { method: 'POST' });
}

/** `DurableProbeStore.kind` is private; read it back for the wiring assertion. */
function kindOf(sink: unknown): string {
  return (sink as { kind: string }).kind;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkCronAuth.mockReturnValue(null);
  mocks.checkDurableStore.mockReturnValue(null);
  mocks.acquireLock.mockResolvedValue(true);
  mocks.releaseLock.mockResolvedValue(undefined);
  mocks.getReputationStore.mockReturnValue({
    recordProbeSample: vi.fn().mockResolvedValue(undefined),
  });
  mocks.probeAllAnchors.mockResolvedValue(new Map([['a.example', {}]]));
  mocks.probeAllAnchorQuotes.mockResolvedValue([{}, {}]);
  mocks.probeAllAnchorIssuers.mockResolvedValue([{}, {}, {}]);
  mocks.probeAllAnchorIntegrity.mockResolvedValue([{}]);
  mocks.probeAllAnchorSep31.mockResolvedValue([{}, {}, {}, {}]);
});

describe('POST /api/reputation/refresh probe sweep', () => {
  it('runs the SEP-31 probe once with a sep31-info DurableProbeStore', async () => {
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mocks.probeAllAnchorSep31).toHaveBeenCalledTimes(1);
    const sink = mocks.probeAllAnchorSep31.mock.calls[0]![0];
    expect(sink).toBeInstanceOf(DurableProbeStore);
    expect(kindOf(sink)).toBe('sep31-info');
  });

  it('runs every other probe once, each with its own sink kind', async () => {
    await POST(makeRequest());

    const expected: [ReturnType<typeof vi.fn>, string][] = [
      [mocks.probeAllAnchors, 'uptime'],
      [mocks.probeAllAnchorQuotes, 'quote'],
      [mocks.probeAllAnchorIssuers, 'issuer-mismatch'],
      [mocks.probeAllAnchorIntegrity, 'toml-integrity'],
    ];
    for (const [probe, kind] of expected) {
      expect(probe).toHaveBeenCalledTimes(1);
      expect(kindOf(probe.mock.calls[0]![0])).toBe(kind);
    }
  });

  it('includes sep31Info in the response counts', async () => {
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.probed).toMatchObject({
      uptime: 1,
      quote: 2,
      issuerMismatch: 3,
      tomlIntegrity: 1,
      sep31Info: 4,
      persisted: 0,
      failed: 0,
    });
  });

  it('counts samples the SEP-31 sink persists', async () => {
    const recordProbeSample = vi.fn().mockResolvedValue(undefined);
    mocks.getReputationStore.mockReturnValue({ recordProbeSample });
    mocks.probeAllAnchorSep31.mockImplementation(async (sink: DurableProbeStore) => {
      sink.record({
        domain: 'a.example',
        reachable: true,
        latencyMs: 12,
        at: Date.now(),
      });
      return [{}];
    });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(recordProbeSample).toHaveBeenCalledTimes(1);
    expect(recordProbeSample.mock.calls[0]![0]).toMatchObject({ kind: 'sep31-info' });
    expect(body.probed.persisted).toBe(1);
    expect(body.probed.sep31Info).toBe(1);
  });

  it('short-circuits before any probe when cron auth fails', async () => {
    mocks.checkCronAuth.mockReturnValue(NextResponse.json({ error: 'no' }, { status: 401 }));

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(mocks.probeAllAnchorSep31).not.toHaveBeenCalled();
    expect(mocks.acquireLock).not.toHaveBeenCalled();
  });

  it('short-circuits when no durable store is configured', async () => {
    mocks.checkDurableStore.mockReturnValue(
      NextResponse.json({ error: 'unavailable' }, { status: 503 })
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(503);
    expect(mocks.probeAllAnchorSep31).not.toHaveBeenCalled();
  });

  it('returns 409 without probing when the lock is held', async () => {
    mocks.acquireLock.mockResolvedValue(false);

    const res = await POST(makeRequest());

    expect(res.status).toBe(409);
    expect(mocks.probeAllAnchorSep31).not.toHaveBeenCalled();
    expect(mocks.releaseLock).not.toHaveBeenCalled();
  });

  it('releases the lock after a successful sweep', async () => {
    await POST(makeRequest());
    expect(mocks.releaseLock).toHaveBeenCalledWith('reputation-refresh');
  });
});
