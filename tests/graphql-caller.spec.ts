import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/graphql/route';
import { checkRateLimit, clearRateLimitStore } from '@/lib/api/rate-limit';
import { generateApiKey, type ApiScope } from '@/lib/auth/api-keys';
import { InMemoryApiKeyStore, _setApiKeyStore } from '@/lib/auth/key-store';
import { InMemoryAuditStore, _setAuditStore, type AuditEvent } from '@/lib/audit/store';
import { flushAuditEvents } from '@/lib/audit/record';
import { flags } from '@/lib/flags';
import * as offrampModule from '@/lib/intent/offramp';

const VALID_SENDER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const MUTATION = `
  mutation($input: OfframpIntentInput!) {
    submitOfframpIntent(input: $input) {
      quoteId
      unsignedTx
      route { anchorId anchorDomain corridorId }
    }
  }
`;

const VALID_INPUT = {
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '100',
  sender: VALID_SENDER,
  recipient: 'NGN-BANK-ACCOUNT-123',
};

interface GraphQLResponse<T = unknown> {
  data: T | null;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

function makeRequest(
  query: string,
  variables?: Record<string, unknown>,
  headers?: HeadersInit
): NextRequest {
  return new NextRequest('http://localhost/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ query, variables }),
  });
}

let keyStore: InMemoryApiKeyStore;
let auditStore: InMemoryAuditStore;

/** Stores a key with these scopes and returns the raw key and its caller id. */
async function seedKey(scopes: ApiScope[]): Promise<{ key: string; callerId: string }> {
  const generated = await generateApiKey();
  await keyStore.create({
    keyId: generated.keyId,
    displayPrefix: generated.displayPrefix,
    hash: generated.hash,
    name: 'graphql-test',
    scopes,
    tier: 'standard',
    maxIntentAmount: null,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
  });
  return { key: generated.key, callerId: `key:${generated.keyId}` };
}

async function getAuditEvents(): Promise<AuditEvent[]> {
  await flushAuditEvents();
  return auditStore.listRange({
    from: '2000-01-01T00:00:00.000Z',
    to: '2100-01-01T00:00:00.000Z',
    limit: 1000,
  });
}

describe('POST /api/graphql — caller identity, limits, scopes and audit (#2215)', () => {
  const originalRequireKeyForWrites = flags.requireKeyForWrites;

  beforeEach(() => {
    clearRateLimitStore();
    keyStore = new InMemoryApiKeyStore();
    _setApiKeyStore(keyStore);
    auditStore = new InMemoryAuditStore();
    _setAuditStore(auditStore);
    flags.requireKeyForWrites = false;
    vi.stubEnv('ANCHOR_PAYMENT_ACCOUNTS', JSON.stringify({ moneygram: VALID_SENDER }));
  });

  afterEach(() => {
    flags.requireKeyForWrites = originalRequireKeyForWrites;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    _setApiKeyStore(null);
    _setAuditStore(null);
  });

  it('allows an anonymous query with 200 and rejects an invalid key with 401 UNAUTHENTICATED', async () => {
    const anonRes = await POST(makeRequest('{ anchors { id } }'));
    expect(anonRes.status).toBe(200);
    const anonBody = (await anonRes.json()) as GraphQLResponse<{ anchors: Array<{ id: string }> }>;
    expect(anonBody.errors).toBeUndefined();
    expect(anonBody.data?.anchors.length).toBeGreaterThan(0);

    const badKeyRes = await POST(
      makeRequest('{ anchors { id } }', undefined, { 'x-api-key': 'sik_invalid_key' })
    );
    expect(badKeyRes.status).toBe(401);
    const badKeyBody = (await badKeyRes.json()) as GraphQLResponse;
    expect(badKeyBody.data).toBeNull();
    expect(badKeyBody.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  it('denies mutation for a quotes:read-only key with FORBIDDEN without calling createOfframpIntent', async () => {
    const keyReadOnly = await seedKey(['quotes:read']);

    const spy = vi.spyOn(offrampModule, 'createOfframpIntent');

    const res = await POST(
      makeRequest(MUTATION, { input: VALID_INPUT }, { 'x-api-key': keyReadOnly.key })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as GraphQLResponse;
    expect(body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(spy).not.toHaveBeenCalled();

    const audit = (await getAuditEvents()).find((e) => e.action === 'Mutation.submitOfframpIntent');
    expect(audit?.outcome).toBe('denied');
    expect(audit?.callerId).toBe(keyReadOnly.callerId);
  });

  it('denies anonymous mutation with FORBIDDEN when flags.requireKeyForWrites is true', async () => {
    flags.requireKeyForWrites = true;

    const spy = vi.spyOn(offrampModule, 'createOfframpIntent');

    const res = await POST(makeRequest(MUTATION, { input: VALID_INPUT }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as GraphQLResponse;
    expect(body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN when an intents:write-only key runs a query', async () => {
    const keyWriteOnly = await seedKey(['intents:write']);

    const res = await POST(
      makeRequest('{ anchors { id } }', undefined, { 'x-api-key': keyWriteOnly.key })
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as GraphQLResponse;
    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });

  it('keeps a keyed caller api.graphql bucket independent of an anonymous caller on the same IP', async () => {
    const ip = '198.51.100.77';
    const keyIndependent = await seedKey(['quotes:read']);

    // Exhaust the anonymous IP's bucket
    for (let i = 0; i < 60; i += 1) {
      await checkRateLimit(ip, { bucket: 'api.graphql', maxRequests: 60 });
    }

    const anonRes = await POST(
      makeRequest('{ anchors { id } }', undefined, { 'x-forwarded-for': ip })
    );
    expect(anonRes.status).toBe(429);

    // Keyed caller on the exact same IP is still allowed
    const keyedRes = await POST(
      makeRequest('{ anchors { id } }', undefined, {
        'x-forwarded-for': ip,
        'x-api-key': keyIndependent.key,
      })
    );
    expect(keyedRes.status).toBe(200);
  });

  it('records a mutation audit event with intentHash === quoteId and no sender/recipient PII', async () => {
    const keyWriter = await seedKey(['quotes:read', 'intents:write']);

    const res = await POST(
      makeRequest(MUTATION, { input: VALID_INPUT }, { 'x-api-key': keyWriter.key })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as GraphQLResponse<{
      submitOfframpIntent: { quoteId: string };
    }>;
    expect(body.errors).toBeUndefined();
    const quoteId = body.data?.submitOfframpIntent.quoteId;
    expect(quoteId).toMatch(/^[0-9a-f]{64}$/);

    const events = await getAuditEvents();
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event).toBeDefined();
    expect(event?.surface).toBe('graphql');
    expect(event?.action).toBe('Mutation.submitOfframpIntent');
    expect(event?.scope).toBe('intents:write');
    expect(event?.intentHash).toBe(quoteId);
    expect(event?.outcome).toBe('ok');
    expect(event?.callerId).toBe(keyWriter.callerId);
    expect(event?.callerKind).toBe('key');

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(VALID_SENDER);
    expect(serialized).not.toContain('NGN-BANK-ACCOUNT-123');
  });
});
