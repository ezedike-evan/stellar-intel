import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPERATIONS } from '@/packages/sdk/src/types';
import { API_VERSION as SDK_API_VERSION } from '@/packages/sdk/src/client';
import { API_VERSION as SERVER_API_VERSION } from '@/lib/api/api-version';

// #806 — the SDK's types are hand-written rather than generated (see
// packages/sdk/README.md for why: openapi-typescript peers on TypeScript 5 and
// this repo is on 6). That trade is only acceptable with a drift guard, which
// is this file. It gives the same protection the generator would have: a route
// rename fails here, in CI, rather than at a consumer's runtime.

interface OpenApiSpec {
  info: { version: string };
  paths: Record<string, Record<string, unknown>>;
}

const spec: OpenApiSpec = JSON.parse(
  readFileSync(join(process.cwd(), 'public/openapi.json'), 'utf8')
);

describe('SDK ↔ OpenAPI spec (#806)', () => {
  it('every operation the SDK calls exists in the committed spec', () => {
    for (const [name, operation] of Object.entries(OPERATIONS)) {
      const [method, path] = operation.split(' ') as [string, string];
      const pathItem = spec.paths[path];

      expect(pathItem, `${name}: the spec has no path "${path}"`).toBeDefined();
      expect(
        Object.keys(pathItem!).includes(method.toLowerCase()),
        `${name}: "${path}" exists but has no ${method} operation`
      ).toBe(true);
    }
  });

  it('pins the same API version the server advertises', () => {
    // A pinned client that pins the wrong version 400s on every request. The
    // failure mode is total, so it is worth one assertion.
    expect(SDK_API_VERSION).toBe(SERVER_API_VERSION);
  });

  it('pins the same version the spec declares', () => {
    expect(SDK_API_VERSION).toBe(spec.info.version);
  });

  it('covers every v1 operation the spec publishes', () => {
    const specV1 = Object.entries(spec.paths).flatMap(([path, methods]) =>
      path.startsWith('/api/v1/')
        ? Object.keys(methods).map((m) => `${m.toUpperCase()} ${path}`)
        : []
    );
    const covered = new Set(Object.values(OPERATIONS) as string[]);
    const missing = specV1.filter((op) => !covered.has(op));

    // If a new v1 endpoint ships, this fails and someone decides whether the
    // SDK should expose it — rather than the SDK silently falling behind.
    expect(missing, `SDK does not expose: ${missing.join(', ')}`).toEqual([]);
  });
});
