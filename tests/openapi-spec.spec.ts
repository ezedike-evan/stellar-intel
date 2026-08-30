import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOpenApiSpec } from '@/lib/api/openapi';
import { GET as getApiV1OpenApi } from '@/app/api/v1/openapi.json/route';
import { GET as getRootOpenApi } from '@/app/openapi.json/route';

describe('OpenAPI Spec Publishing & Validation (#1077)', () => {
  it('serves valid OpenAPI 3.1.0 spec at /api/v1/openapi.json', async () => {
    const res = await getApiV1OpenApi();
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
    const res = await getRootOpenApi();
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

    expect(pathKeys).toContain('/health');
    expect(pathKeys).toContain('/rates/{corridor}');
  });
});
