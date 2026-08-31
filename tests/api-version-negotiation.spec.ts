import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import {
  API_VERSION,
  SUPPORTED_API_VERSIONS,
  SUPPORT_WINDOW_DAYS,
  negotiateApiVersion,
  computeSupportedApiVersions,
  type ApiVersionRecord,
} from '@/lib/api/api-version';
import { computeDeprecationHeaders, getAnnouncedDeprecations } from '@/lib/api/deprecation';

// #888 — docs/VERSIONING.md documented request-side version pinning that no
// route implemented, so the policy described behaviour that did not exist.

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://example.test/api/anything', { headers });
}

describe('negotiateApiVersion (#888)', () => {
  it('treats an absent header as "latest"', () => {
    expect(negotiateApiVersion(new Headers())).toEqual({ ok: true, requested: null });
  });

  it('treats a blank header as absent', () => {
    expect(negotiateApiVersion(new Headers({ 'API-Version': '   ' })).ok).toBe(true);
  });

  it('accepts a supported version', () => {
    expect(negotiateApiVersion(new Headers({ 'API-Version': API_VERSION })).ok).toBe(true);
  });

  it('rejects an unsupported version', () => {
    const result = negotiateApiVersion(new Headers({ 'API-Version': '0.9.0' }));
    expect(result.ok).toBe(false);
    expect(result.requested).toBe('0.9.0');
  });

  it('advertises the version responses actually carry', () => {
    expect(SUPPORTED_API_VERSIONS).toContain(API_VERSION);
  });
});

describe('version pinning through withRequestLogger (#888)', () => {
  it('serves normally when the header is absent', async () => {
    const response = await withRequestLogger(request(), 'test', async () =>
      NextResponse.json({ ok: true })
    );
    expect(response.status).toBe(200);
  });

  it('serves normally for a supported version', async () => {
    const response = await withRequestLogger(
      request({ 'API-Version': API_VERSION }),
      'test',
      async () => NextResponse.json({ ok: true })
    );
    expect(response.status).toBe(200);
  });

  it('returns 400 with the supported list for an unsupported version', async () => {
    let handlerRan = false;
    const response = await withRequestLogger(
      request({ 'API-Version': '0.9.0' }),
      'test',
      async () => {
        handlerRan = true;
        return NextResponse.json({ ok: true });
      }
    );

    expect(response.status).toBe(400);
    // Rejected before the handler runs — an unsupported pin must not have side
    // effects.
    expect(handlerRan).toBe(false);

    const body = (await response.json()) as { code: string; supportedVersions: string[] };
    expect(body.code).toBe('UNSUPPORTED_API_VERSION');
    expect(body.supportedVersions).toContain(API_VERSION);
  });

  it('still stamps API-Version on the rejection', async () => {
    const response = await withRequestLogger(
      request({ 'API-Version': '0.9.0' }),
      'test',
      async () => NextResponse.json({ ok: true })
    );
    // A client that pinned wrongly still needs to learn what it is talking to.
    expect(response.headers.get('API-Version')).toBe(API_VERSION);
  });
});

// ─── Support window + deprecation lifecycle (#1150) ────────────────────────────
//
// SUPPORTED_API_VERSIONS has exactly one entry in real production history
// (nothing has ever been retired), so the window and the Sunset/Warning
// headers it unlocks are exercised here against synthetic history rather than
// waiting on a real second version to exist — the same reason
// computeSupportedApiVersions and computeDeprecationHeaders both take
// injectable history/now parameters.

const OLD_VERSION = '1.2.0';

function historyWithOneRetiredVersion(supersededDaysAgo: number): ApiVersionRecord[] {
  const supersededAt = new Date(Date.now() - supersededDaysAgo * 24 * 60 * 60 * 1000).toISOString();
  return [
    { version: OLD_VERSION, supersededAt },
    { version: API_VERSION, supersededAt: null },
  ];
}

describe('computeSupportedApiVersions: the 180-day boundary (#1150)', () => {
  it('keeps a version retired 10 days ago inside the window', () => {
    expect(computeSupportedApiVersions(historyWithOneRetiredVersion(10))).toEqual([
      OLD_VERSION,
      API_VERSION,
    ]);
  });

  it('keeps a version retired 179 days ago inside the window', () => {
    expect(computeSupportedApiVersions(historyWithOneRetiredVersion(179))).toContain(OLD_VERSION);
  });

  it('drops a version retired 181 days ago', () => {
    expect(computeSupportedApiVersions(historyWithOneRetiredVersion(181))).toEqual([API_VERSION]);
  });

  it('never drops the current version, which has no supersededAt', () => {
    expect(computeSupportedApiVersions(historyWithOneRetiredVersion(10_000))).toContain(
      API_VERSION
    );
  });

  it('matches SUPPORT_WINDOW_DAYS exactly at the boundary', () => {
    const justInside = SUPPORT_WINDOW_DAYS - 0.01;
    const justOutside = SUPPORT_WINDOW_DAYS + 0.01;
    expect(computeSupportedApiVersions(historyWithOneRetiredVersion(justInside))).toContain(
      OLD_VERSION
    );
    expect(computeSupportedApiVersions(historyWithOneRetiredVersion(justOutside))).not.toContain(
      OLD_VERSION
    );
  });
});

describe('a deprecated-but-supported version still negotiates and carries both headers (#1150)', () => {
  it('negotiateApiVersion accepts a version still inside the window', () => {
    const history = historyWithOneRetiredVersion(10);
    const supported = computeSupportedApiVersions(history);
    const result = negotiateApiVersion(new Headers({ 'API-Version': OLD_VERSION }), supported);
    expect(result).toEqual({ ok: true, requested: OLD_VERSION });
  });

  it('negotiateApiVersion rejects the same version once it has left the window', () => {
    const history = historyWithOneRetiredVersion(200);
    const supported = computeSupportedApiVersions(history);
    const result = negotiateApiVersion(new Headers({ 'API-Version': OLD_VERSION }), supported);
    expect(result).toEqual({ ok: false, requested: OLD_VERSION });
  });

  it('computeDeprecationHeaders sets both Sunset and Warning: 299 for a version inside the window', () => {
    const history = historyWithOneRetiredVersion(10);
    const { sunset, warning } = computeDeprecationHeaders(OLD_VERSION, history);

    expect(sunset).not.toBeNull();
    // Sunset is an HTTP-date (RFC 7231) — parseable and in the future.
    expect(new Date(sunset as string).getTime()).toBeGreaterThan(Date.now());

    expect(warning).toMatch(/^299 - /);
    expect(warning).toContain(OLD_VERSION);
  });

  it('computeDeprecationHeaders returns nulls for the current version', () => {
    const history = historyWithOneRetiredVersion(10);
    expect(computeDeprecationHeaders(API_VERSION, history)).toEqual({
      sunset: null,
      warning: null,
    });
  });

  it('computeDeprecationHeaders returns nulls once the window has closed', () => {
    const history = historyWithOneRetiredVersion(200);
    expect(computeDeprecationHeaders(OLD_VERSION, history)).toEqual({
      sunset: null,
      warning: null,
    });
  });

  it('computeDeprecationHeaders returns nulls when no version was pinned', () => {
    const history = historyWithOneRetiredVersion(10);
    expect(computeDeprecationHeaders(null, history)).toEqual({ sunset: null, warning: null });
  });
});

describe('/api/status announced_deprecations (#1150)', () => {
  it('lists a version still inside its sunset window', () => {
    const history = historyWithOneRetiredVersion(10);
    const announced = getAnnouncedDeprecations(history);
    expect(announced).toHaveLength(1);
    expect(announced[0]).toMatchObject({ version: OLD_VERSION });
    expect(new Date(announced[0]!.sunsetAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('omits a version once its sunset window has closed', () => {
    const history = historyWithOneRetiredVersion(200);
    expect(getAnnouncedDeprecations(history)).toEqual([]);
  });

  it('is empty against real production history (nothing has ever been retired)', () => {
    expect(getAnnouncedDeprecations()).toEqual([]);
  });
});

// ─── Doc/code drift guard (#874) ──────────────────────────────────────────────
//
// docs/VERSIONING.md's "Version support window" table claimed "current + 1
// previous, 180 days" while SUPPORTED_API_VERSIONS held exactly one element and
// negotiateApiVersion 400'd everything else. Nobody noticed because nothing
// compared the two. This does.
//
// Same philosophy as tests/openapi-coverage.spec.ts: a document that makes a
// checkable claim about code should be checked against it.

describe('docs/VERSIONING.md matches the enforced support window (#874)', () => {
  const versioningDoc = readFileSync(join(process.cwd(), 'docs/VERSIONING.md'), 'utf8');

  it('marks the REST row "current only" while exactly one version is supported', () => {
    const restRow = versioningDoc.split('\n').find((line) => line.startsWith('| HTTP REST API'));

    expect(restRow, 'the Version support window table lost its HTTP REST API row').toBeDefined();

    if (SUPPORTED_API_VERSIONS.length === 1) {
      // Adding a version to the array without updating the doc fails here.
      expect(restRow).toMatch(/Current only/i);
    } else {
      expect(
        restRow,
        `SUPPORTED_API_VERSIONS now has ${SUPPORTED_API_VERSIONS.length} entries — ` +
          'update the "Version support window" row in docs/VERSIONING.md to match.'
      ).not.toMatch(/Current only/i);
    }
  });

  it('keeps the footnote explaining the gap for as long as the gap exists', () => {
    if (SUPPORTED_API_VERSIONS.length > 1) return;
    expect(versioningDoc).toContain('The stated window is not yet what the code enforces');
  });

  it('does not claim a deprecation header that no code emits', () => {
    // If someone implements Sunset/Warning, this fails and the "Not yet
    // implemented" callout should come out of the doc in the same PR.
    const emitsSunset =
      existsSync(join(process.cwd(), 'lib/api/deprecation.ts')) ||
      existsSync(join(process.cwd(), 'app/api/status/route.ts'));

    if (!emitsSunset) {
      expect(versioningDoc).toContain('Not yet implemented');
    }
  });
});
