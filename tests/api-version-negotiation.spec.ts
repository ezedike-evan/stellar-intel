import { describe, it, expect } from 'vitest';
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
