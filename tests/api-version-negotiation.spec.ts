import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { API_VERSION, SUPPORTED_API_VERSIONS, negotiateApiVersion } from '@/lib/api/api-version';

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
