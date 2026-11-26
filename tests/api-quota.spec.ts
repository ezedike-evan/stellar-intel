import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/stellar/server-rates', () => ({
  fetchCorridorRates: vi.fn().mockImplementation(async (corridorId: string) => ({
    corridorId,
    rates: [],
    pending: [],
    bestRateId: null,
    errors: [],
  })),
}));

import { GET as healthGet } from '@/app/api/v1/health/route';
import { POST as mcpPost } from '@/app/api/mcp/route';
import { POST as graphqlPost } from '@/app/api/graphql/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { _setDailyQuotas } from '@/lib/api/quota';
import { InMemoryApiKeyStore, _setApiKeyStore, type ApiKeyRecord } from '@/lib/auth/key-store';
import { generateApiKey } from '@/lib/auth/api-keys';

const MCP_ACCEPT = 'application/json, text/event-stream';

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
  },
};

async function seedKey(
  store: InMemoryApiKeyStore,
  overrides: Partial<ApiKeyRecord> = {}
): Promise<{ key: string; record: ApiKeyRecord }> {
  const generated = await generateApiKey();
  const record: ApiKeyRecord = {
    keyId: generated.keyId,
    displayPrefix: generated.displayPrefix,
    hash: generated.hash,
    name: 'test key',
    scopes: ['quotes:read'],
    tier: 'standard',
    maxIntentAmount: null,
    createdAt: '2026-11-22T10:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ...overrides,
  };
  await store.create(record);
  return { key: generated.key, record };
}

function keyedHealth(key: string): NextRequest {
  return new NextRequest('http://localhost/api/v1/health', {
    headers: { 'x-forwarded-for': '1.2.3.4', Authorization: `Bearer ${key}` },
  });
}

function keyedMcp(key: string): NextRequest {
  return new NextRequest('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: MCP_ACCEPT,
      'x-forwarded-for': '1.2.3.4',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(INITIALIZE),
  });
}

function keyedGraphql(key: string): NextRequest {
  return new NextRequest('http://localhost/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '1.2.3.4',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ query: '{ anchors { id } }' }),
  });
}

describe('daily request quotas per caller tier (AGS024, #2217)', () => {
  let store: InMemoryApiKeyStore;
  let standardKey: string;
  let partnerKey: string;

  beforeEach(async () => {
    clearRateLimitStore();
    store = new InMemoryApiKeyStore();
    _setApiKeyStore(store);
    _setDailyQuotas({ standard: 3 });
    ({ key: standardKey } = await seedKey(store, { tier: 'standard' }));
    ({ key: partnerKey } = await seedKey(store, { tier: 'partner' }));
  });

  afterEach(() => {
    _setApiKeyStore(null);
    _setDailyQuotas(null);
    vi.unstubAllEnvs();
  });

  it('an anonymous v1 response has no X-Quota-* headers', async () => {
    const res = await healthGet(
      new NextRequest('http://localhost/api/v1/health', {
        headers: { 'x-forwarded-for': '1.2.3.4' },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Quota-Limit')).toBeNull();
    expect(res.headers.get('X-Quota-Remaining')).toBeNull();
    expect(res.headers.get('X-Quota-Reset')).toBeNull();
  });

  it('a keyed response carries quota headers and X-Quota-Remaining decrements', async () => {
    const first = await healthGet(keyedHealth(standardKey));
    expect(first.headers.get('X-Quota-Limit')).toBe('3');
    expect(first.headers.get('X-Quota-Remaining')).toBe('2');
    expect(first.headers.get('X-Quota-Reset')).not.toBeNull();

    const second = await healthGet(keyedHealth(standardKey));
    expect(second.headers.get('X-Quota-Remaining')).toBe('1');
  });

  it('the 4th keyed v1 request gives 429 quota_exceeded with Retry-After', async () => {
    await healthGet(keyedHealth(standardKey));
    await healthGet(keyedHealth(standardKey));
    await healthGet(keyedHealth(standardKey));

    const fourth = await healthGet(keyedHealth(standardKey));
    expect(fourth.status).toBe(429);
    const body = (await fourth.json()) as { error: { code: string } };
    expect(body.error.code).toBe('quota_exceeded');
    expect(fourth.headers.get('Retry-After')).not.toBeNull();
    expect(fourth.headers.get('X-Quota-Remaining')).toBe('0');
  });

  it('the quota is shared: 2 v1 calls plus 1 MCP call exhaust it for GraphQL', async () => {
    await healthGet(keyedHealth(standardKey));
    await healthGet(keyedHealth(standardKey));

    const mcp = await mcpPost(keyedMcp(standardKey));
    expect(mcp.status).toBe(200);
    expect(mcp.headers.get('X-Quota-Remaining')).toBe('0');

    const gql = await graphqlPost(keyedGraphql(standardKey));
    expect(gql.status).toBe(429);
    const body = (await gql.json()) as {
      data: null;
      errors: Array<{ message: string; extensions?: { code?: string } }>;
    };
    expect(body).toEqual({
      data: null,
      errors: [{ message: 'Daily quota exceeded', extensions: { code: 'QUOTA_EXCEEDED' } }],
    });
  });

  it('a partner key with a null quota has no quota headers', async () => {
    _setDailyQuotas({ partner: null });
    const res = await healthGet(keyedHealth(partnerKey));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Quota-Limit')).toBeNull();
    expect(res.headers.get('X-Quota-Remaining')).toBeNull();
    expect(res.headers.get('X-Quota-Reset')).toBeNull();
  });
});
