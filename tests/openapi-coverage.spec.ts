import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// #918 — every route must appear in the OpenAPI spec, and stay there.
//
// Thirteen of twenty-nine routes were undocumented while the spec's own
// description claimed the hardening contract applied to every response. As with
// rate-limit coverage, the failure worth guarding is the *next* undocumented
// route, which no per-path test catches.

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

/** `app/api/reputation/[anchor]/route.ts` -> `/api/reputation/{anchor}` */
function toSpecPath(file: string): string {
  return (
    '/' +
    file
      .replace(/^app\//, '')
      .replace(/\/route\.ts$/, '')
      .replace(/\[([^\]]+)\]/g, '{$1}')
  );
}

const spec = JSON.parse(readFileSync('public/openapi.json', 'utf8')) as {
  paths: Record<string, unknown>;
  info: { version: string };
};

/**
 * Routes deliberately absent from the spec, with the reason.
 *
 * `/api/v1/openapi.json` serves this document. Listing it inside itself buys a
 * consumer nothing, and because it sits under `/api/v1/`, documenting it would
 * oblige every SDK to expose a meta-operation for it — tests/sdk-spec-sync.spec.ts
 * (#806) fails on any published v1 operation the SDKs do not cover, and there
 * are three of them (ts, py, rs). The guard this file exists for is an
 * undocumented *data* route; this is not one.
 */
const UNDOCUMENTED_BY_DESIGN = new Set(['/api/v1/openapi.json']);

describe('OpenAPI coverage (#918)', () => {
  const files = [...routeFiles('app/api'), ...routeFiles('app/v1')];

  it('documents every route file', () => {
    const undocumented = files
      .map(toSpecPath)
      .filter((p) => !UNDOCUMENTED_BY_DESIGN.has(p) && !(p in spec.paths));
    expect(undocumented).toEqual([]);
  });

  it('documents no path that has no route', () => {
    // Catches the opposite drift: a route deleted or renamed while its spec
    // entry lingers, so the published contract promises something that 404s.
    const routes = new Set(files.map(toSpecPath));
    const orphans = Object.keys(spec.paths).filter((p) => !routes.has(p));
    expect(orphans).toEqual([]);
  });

  it('keeps info.version in step with API_VERSION', async () => {
    const { API_VERSION } = await import('@/lib/api/api-version');
    // A spec whose version lags the header it documents is worse than no
    // version at all — a client would pin to the wrong contract.
    expect(spec.info.version).toBe(API_VERSION);
  });
});
