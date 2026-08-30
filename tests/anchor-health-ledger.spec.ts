/**
 * @vitest-environment node
 *
 * Issue #1098 — the anchor health ledger as a versioned artifact.
 *
 * `constants/anchor-health.json` is rewritten nightly and committed, so its
 * history lived only in git and a consumer who wanted the series had to clone
 * the repo and walk commits. These tests cover the route that publishes it:
 * today's ledger from the committed file, a past date from that file's own git
 * history, and the failure modes in between.
 *
 * No network: the GitHub lookups are stubbed, and the "latest" path asserts it
 * makes no request at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const LEDGER = {
  thresholdNights: 3,
  updatedAt: '2026-08-26T04:57:02.450Z',
  anchors: {
    cowrie: {
      consecutiveFailures: 2,
      degraded: false,
      lastCheckedAt: '2026-08-26T04:57:02.450Z',
      lastStatus: 'fail',
      lastError: 'missing TRANSFER_SERVER_SEP0024 (SEP-24)',
    },
  },
};

const ARCHIVED_LEDGER = {
  thresholdNights: 3,
  updatedAt: '2026-08-20T04:12:00.000Z',
  anchors: {
    cowrie: {
      consecutiveFailures: 0,
      degraded: false,
      lastCheckedAt: '2026-08-20T04:12:00.000Z',
      lastStatus: 'ok',
      lastError: null,
    },
  },
};

// The committed file this deployment was built with. Pinned rather than read
// from disk so these assertions don't change every night the validator runs.
vi.mock('@/constants/anchor-health.json', () => ({ default: LEDGER }));

const { GET } = await import('@/app/api/v1/anchor-health/ledger/route');
const { ledgerArtifactForDate, latestLedgerArtifact, LedgerLookupError } =
  await import('@/lib/stellar/health-ledger');

const ARCHIVE_COMMIT = 'c'.repeat(40);

interface StubbedCall {
  status?: number;
  body: unknown;
}

/** Answers the commits lookup and the raw file read, and nothing else. */
function stubGitHub(commits: StubbedCall, raw: StubbedCall = { body: ARCHIVED_LEDGER }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call = url.includes('api.github.com') ? commits : raw;
    const status = call.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => call.body,
      text: async () => JSON.stringify(call.body),
    } as Response;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function request(query = ''): NextRequest {
  return new NextRequest(`https://stellar-intel.vercel.app/api/v1/anchor-health/ledger${query}`);
}

describe('anchor health ledger artifact (#1098)', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    // Any unstubbed call throws, so a test that thinks it is offline really is.
    globalThis.fetch = vi.fn(async () => {
      throw new Error('unexpected network call');
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.ANCHOR_HEALTH_LEDGER_REPO;
  });

  describe('the latest ledger', () => {
    it('serves the committed file, versioned by its own updatedAt', async () => {
      const response = await GET(request());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.version).toBe('2026-08-26');
      expect(body.source).toBe('committed');
      expect(body.commit).toBeNull();
      expect(body.requestedDate).toBeNull();
      expect(body.ledger).toEqual(LEDGER);
    });

    it('answers without touching the network', async () => {
      // Today's ledger is deployed with the app. If it ever depended on GitHub
      // being up, the most-requested case would be the least reliable one.
      await expect(GET(request())).resolves.toBeDefined();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('is cacheable, but only briefly — it is rewritten nightly', async () => {
      const response = await GET(request());

      expect(response.headers.get('Cache-Control')).toContain('max-age=300');
      expect(response.headers.get('Cache-Control')).not.toContain('immutable');
      expect(response.headers.get('ETag')).toBe('"anchor-health-2026-08-26"');
    });

    it('still carries the v1 hardening headers', async () => {
      const response = await GET(request());

      expect(response.headers.get('X-Request-Id')).toBeTruthy();
      expect(response.headers.get('X-RateLimit-Limit')).toBe('60');
    });
  });

  describe('a past date', () => {
    it('resolves the ledger from the commit that last touched the file', async () => {
      const fetchMock = stubGitHub({ body: [{ sha: ARCHIVE_COMMIT }] });

      const response = await GET(request('?date=2026-08-21'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.source).toBe('git-history');
      expect(body.commit).toBe(ARCHIVE_COMMIT);
      expect(body.requestedDate).toBe('2026-08-21');
      // The version is the ledger's own date, not the date that was asked for:
      // a consumer can see which nightly run they actually received.
      expect(body.version).toBe('2026-08-20');
      expect(body.ledger).toEqual(ARCHIVED_LEDGER);

      const commitsUrl = String(fetchMock.mock.calls[0]?.[0]);
      expect(commitsUrl).toContain('constants%2Fanchor-health.json');
      expect(commitsUrl).toContain('until=2026-08-21T23%3A59%3A59Z');
      expect(String(fetchMock.mock.calls[1]?.[0])).toContain(ARCHIVE_COMMIT);
    });

    it('is cached as immutable — a past date can never change', async () => {
      stubGitHub({ body: [{ sha: ARCHIVE_COMMIT }] });

      const response = await GET(request('?date=2026-08-21'));

      expect(response.headers.get('Cache-Control')).toContain('immutable');
    });

    it('reads the repository the deployment is told to track', async () => {
      process.env.ANCHOR_HEALTH_LEDGER_REPO = 'someone-else/stellar-intel';
      const fetchMock = stubGitHub({ body: [{ sha: ARCHIVE_COMMIT }] });

      await GET(request('?date=2026-08-21'));

      expect(String(fetchMock.mock.calls[0]?.[0])).toContain('someone-else/stellar-intel');
    });

    it('serves the committed file for a date at or after its version', async () => {
      // The deployed file is the source of truth. Asking for today, or for a
      // date past it, must not depend on GitHub being reachable.
      const response = await GET(request('?date=2026-08-26'));
      const body = await response.json();

      expect(body.source).toBe('committed');
      expect(body.requestedDate).toBe('2026-08-26');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('rejects a malformed date', async () => {
      const response = await GET(request('?date=26-08-2026'));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe('validation_error');
    });

    it('rejects a date that does not exist', async () => {
      const response = await GET(request('?date=2026-02-31'));

      expect(response.status).toBe(400);
    });

    it('404s when the ledger did not exist yet', async () => {
      stubGitHub({ body: [] });

      const response = await GET(request('?date=2019-01-01'));
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error.message).toContain('2019-01-01');
    });

    it('502s when the archived revision is not a ledger', async () => {
      // An archived file is outside this deployment's control, so a malformed
      // one is reported as the archive's failure rather than as a 500 here.
      stubGitHub({ body: [{ sha: ARCHIVE_COMMIT }] }, { body: '<!doctype html>' });

      const response = await GET(request('?date=2026-08-21'));
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body.error.code).toBe('upstream_unavailable');
    });

    it('502s when the history cannot be read, rather than blaming itself', async () => {
      stubGitHub({ status: 403, body: { message: 'rate limit exceeded' } });

      const response = await GET(request('?date=2026-08-21'));
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body.error.code).toBe('upstream_unavailable');
    });
  });

  describe('ledgerArtifactForDate', () => {
    it('reports an unreachable archive as UPSTREAM_UNAVAILABLE, not a crash', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('ENOTFOUND api.github.com');
      }) as unknown as typeof fetch;

      await expect(ledgerArtifactForDate('2026-08-21')).rejects.toMatchObject({
        name: 'LedgerLookupError',
        code: 'UPSTREAM_UNAVAILABLE',
      });
    });

    it('rejects a malformed date before making any request', async () => {
      await expect(ledgerArtifactForDate('yesterday')).rejects.toBeInstanceOf(LedgerLookupError);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('agrees with latestLedgerArtifact about the version it publishes', () => {
      expect(latestLedgerArtifact().version).toBe('2026-08-26');
    });
  });
});
