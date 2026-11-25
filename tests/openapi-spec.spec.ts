import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOpenApiSpec } from '@/lib/api/openapi';
import { GET as getApiV1OpenApi } from '@/app/api/v1/openapi.json/route';
import { GET as getRootOpenApi } from '@/app/openapi.json/route';

// Both routes are rate-limited (#733), so they take the request whose headers
// the limiter reads to identify the caller.
const req = (url: string) => new NextRequest(url);

describe('OpenAPI Spec Publishing & Validation (#1077)', () => {
  it('serves valid OpenAPI 3.1.0 spec at /api/v1/openapi.json', async () => {
    const res = await getApiV1OpenApi(req('http://localhost/api/v1/openapi.json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');

    const json = await res.json();
    expect(json.openapi).toBe('3.1.0');
    expect(json.info.title).toBe('Stellar Intel API');
    expect(json.info.version).toBeDefined();
    expect(json.paths).toBeDefined();
    expect(Object.keys(json.paths).length).toBeGreaterThan(0);
  });

  it('serves valid OpenAPI spec at /openapi.json', async () => {
    const res = await getRootOpenApi(req('http://localhost/openapi.json'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.openapi).toBe('3.1.0');
  });

  it('committed public/openapi.json is in sync with buildOpenApiSpec() (no drift)', () => {
    const spec = buildOpenApiSpec();
    const diskPath = resolve(process.cwd(), 'public/openapi.json');
    const diskContent = readFileSync(diskPath, 'utf-8');
    const diskJson = JSON.parse(diskContent);

    expect(diskJson).toEqual(spec);
  });

  it('includes key public v1 API paths in the document', () => {
    const spec = buildOpenApiSpec();
    const pathKeys = Object.keys(spec.paths ?? {});

    // lib/api/openapi.ts keys paths by their full request path, not by a
    // path relative to a server prefix — assert the shape the spec actually has.
    expect(pathKeys).toContain('/api/v1/health');
    expect(pathKeys).toContain('/api/rates/{corridor}');
  });

  it('defines every referenced security scheme and marks all admin routes with adminKey', () => {
    const spec = buildOpenApiSpec();
    const definedSchemes = new Set(Object.keys(spec.components?.securitySchemes ?? {}));
    expect(definedSchemes.has('adminKey')).toBe(true);
    expect(definedSchemes.has('bearerAuth')).toBe(true);
    expect(definedSchemes.has('callerKey')).toBe(true);

    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
    for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
      if (!pathItem) continue;
      for (const method of methods) {
        const op = (
          pathItem as Record<string, { security?: Array<Record<string, unknown>> } | undefined>
        )[method];
        if (!op) continue;
        for (const reqObj of op.security ?? []) {
          for (const schemeName of Object.keys(reqObj)) {
            expect(
              definedSchemes.has(schemeName),
              `Unknown scheme ${schemeName} on ${method.toUpperCase()} ${path}`
            ).toBe(true);
          }
        }
        if (
          path.startsWith('/api/admin/') ||
          path.startsWith('/api/webhooks/subscriptions') ||
          path.startsWith('/api/webhooks/failures')
        ) {
          const usesAdminKey = (op.security ?? []).some((reqObj) => 'adminKey' in reqObj);
          expect(
            usesAdminKey,
            `Expected adminKey security on ${method.toUpperCase()} ${path}`
          ).toBe(true);
        }
      }
    }
  });
});
