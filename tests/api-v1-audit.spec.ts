import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { InMemoryAuditStore, _setAuditStore, type AuditEvent } from '@/lib/audit/store';
import { flushAuditEvents } from '@/lib/audit/record';
import { generateApiKey } from '@/lib/auth/api-keys';
import { InMemoryApiKeyStore, _setApiKeyStore } from '@/lib/auth/key-store';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { clearIdempotencyStore, withV1 } from '@/lib/api/v1';
import { flags } from '@/lib/flags';
import * as onrampModule from '@/lib/intent/onramp';
import { GET as healthGET } from '@/app/api/v1/health/route';
import { POST as offrampPOST } from '@/app/api/v1/intent/offramp/route';
import { POST as onrampPOST } from '@/app/api/v1/intent/onramp/route';

const VALID_OFFRAMP_BODY = {
  type: 'offramp',
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '100',
  sender: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  recipient: 'NGN-BANK-ACCOUNT-123',
};

const VALID_ONRAMP_BODY = {
  type: 'onramp',
  sourceAsset: 'NGN',
  destinationAsset: 'USDC',
  amount: '150000.00',
  sender: 'NG123456789012345678',
  destination: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  depositMethod: 'bank_transfer',
};

function postOfframp(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/intent/offramp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function postOnramp(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/intent/onramp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function getHealth(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/health', {
    method: 'GET',
    headers,
  });
}

describe('v1 request audit event recording in withV1 (#2207)', () => {
  let auditStore: InMemoryAuditStore;
  let keyStore: InMemoryApiKeyStore;
  const originalRequireKeyForWrites = flags.requireKeyForWrites;

  beforeEach(() => {
    flags.requireKeyForWrites = false;
    clearRateLimitStore();
    clearIdempotencyStore();

    auditStore = new InMemoryAuditStore();
    _setAuditStore(auditStore);

    keyStore = new InMemoryApiKeyStore();
    _setApiKeyStore(keyStore);

    vi.stubEnv(
      'ANCHOR_PAYMENT_ACCOUNTS',
      JSON.stringify({ moneygram: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' })
    );
  });

  afterEach(() => {
    flags.requireKeyForWrites = originalRequireKeyForWrites;
    _setAuditStore(null);
    _setApiKeyStore(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function getAuditEvents(): Promise<AuditEvent[]> {
    return auditStore.listRange({
      from: '1970-01-01T00:00:00.000Z',
      to: '2100-01-01T00:00:00.000Z',
      limit: 100,
    });
  }

  it('Anonymous GET /api/v1/health records nothing. A keyed health GET records one ok event with callerId key:<id>', async () => {
    // 1. Anonymous health GET
    const anonRes = await healthGET(getHealth());
    expect(anonRes.status).toBe(200);
    await flushAuditEvents();

    let events = await getAuditEvents();
    expect(events).toHaveLength(0);

    // 2. Keyed health GET
    const key = await generateApiKey();
    await keyStore.create({
      keyId: key.keyId,
      displayPrefix: key.displayPrefix,
      hash: key.hash,
      name: 'Test Key',
      scopes: ['quotes:read'],
      tier: 'standard',
      maxIntentAmount: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });

    const keyedRes = await healthGET(getHealth({ authorization: `Bearer ${key.key}` }));
    expect(keyedRes.status).toBe(200);
    await flushAuditEvents();

    events = await getAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      surface: 'rest',
      action: 'v1.health',
      scope: 'quotes:read',
      callerId: `key:${key.keyId}`,
      callerKind: 'key',
      outcome: 'ok',
      status: 200,
      intentHash: null,
    });
  });

  it('Anonymous off-ramp POST records one event: action v1.intent.offramp, scope intents:write, a 64-hex intentHash equal to response quoteId, without sender or recipient', async () => {
    const res = await offrampPOST(postOfframp(VALID_OFFRAMP_BODY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { quoteId: string };
    expect(body.quoteId).toMatch(/^[0-9a-f]{64}$/);

    await flushAuditEvents();
    const events = await getAuditEvents();
    expect(events).toHaveLength(1);

    const event = events[0]!;
    expect(event).toMatchObject({
      surface: 'rest',
      action: 'v1.intent.offramp',
      scope: 'intents:write',
      callerId: 'anonymous',
      callerKind: 'anonymous',
      outcome: 'ok',
      status: 200,
      intentHash: body.quoteId,
    });
    expect(event.intentHash).toMatch(/^[0-9a-f]{64}$/);

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(VALID_OFFRAMP_BODY.sender);
    expect(serialized).not.toContain(VALID_OFFRAMP_BODY.recipient);
  });

  it('Anonymous on-ramp POST records one event with 64-hex intentHash equal to response intentHash', async () => {
    const fakeIntentHash = 'ab'.repeat(32);
    vi.spyOn(onrampModule, 'createOnrampIntent').mockResolvedValue({
      ok: true,
      response: {
        route: {
          anchorId: 'anchor-a',
          anchorDomain: 'anchor.example',
          corridorId: 'usdc-ngn',
          asset: 'stellar:USDC:GISSUER',
          estimatedFee: '1.5',
          estimatedReceived: '6.4',
          indicative: true,
        },
        intentHash: fakeIntentHash,
        handoffUrl: '/onramp?corridor=usdc-ngn&amount=10000&anchor=anchor-a',
        unsignedChangeTrustXdr: null,
      },
    });

    const res = await onrampPOST(postOnramp(VALID_ONRAMP_BODY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { intentHash: string };
    expect(body.intentHash).toBe(fakeIntentHash);
    expect(body.intentHash).toMatch(/^[0-9a-f]{64}$/);

    await flushAuditEvents();
    const events = await getAuditEvents();
    expect(events).toHaveLength(1);

    const event = events[0]!;
    expect(event).toMatchObject({
      surface: 'rest',
      action: 'v1.intent.onramp',
      scope: 'intents:write',
      callerId: 'anonymous',
      callerKind: 'anonymous',
      outcome: 'ok',
      status: 200,
      intentHash: fakeIntentHash,
    });
  });

  it('403 scope gives denied', async () => {
    const key = await generateApiKey();
    await keyStore.create({
      keyId: key.keyId,
      displayPrefix: key.displayPrefix,
      hash: key.hash,
      name: 'Read-only Key',
      scopes: ['quotes:read'],
      tier: 'standard',
      maxIntentAmount: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });

    const res = await offrampPOST(
      postOfframp(VALID_OFFRAMP_BODY, { authorization: `Bearer ${key.key}` })
    );
    expect(res.status).toBe(403);

    await flushAuditEvents();
    const events = await getAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      surface: 'rest',
      action: 'v1.intent.offramp',
      scope: 'intents:write',
      callerId: `key:${key.keyId}`,
      callerKind: 'key',
      outcome: 'denied',
      status: 403,
      intentHash: null,
    });
  });

  it('a 429 gives rate_limited', async () => {
    const req = new Request('http://localhost/api/v1/test-rl', {
      headers: { 'x-request-id': 'req-rate-limit' },
    });

    const res1 = await withV1(
      req,
      { bucket: 'test.rl', maxRequests: 1, scope: 'quotes:read' },
      async () => ({ status: 200, body: { ok: true } })
    );
    expect(res1.status).toBe(200);

    const res2 = await withV1(
      req,
      { bucket: 'test.rl', maxRequests: 1, scope: 'quotes:read' },
      async () => ({ status: 200, body: { ok: true } })
    );
    expect(res2.status).toBe(429);

    await flushAuditEvents();
    const events = await getAuditEvents();
    // The first request was anonymous with quotes:read and ok, so omitted.
    // The second was rate_limited, so recorded!
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      surface: 'rest',
      action: 'test.rl',
      scope: 'quotes:read',
      outcome: 'rate_limited',
      status: 429,
    });
  });

  it('a handler that throws gives error with status 500', async () => {
    const res = await withV1(
      new Request('http://localhost/api/v1/test-throw', {
        headers: { 'x-request-id': 'req-throw-1' },
      }),
      { bucket: 'test.throw', maxRequests: 10, scope: 'intents:write' },
      async () => {
        throw new Error('something went wrong');
      }
    );
    expect(res.status).toBe(500);

    await flushAuditEvents();
    const events = await getAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      surface: 'rest',
      action: 'test.throw',
      scope: 'intents:write',
      outcome: 'error',
      status: 500,
      intentHash: null,
    });
  });

  it('an invalid key gives denied with callerId anonymous', async () => {
    const res = await healthGET(
      getHealth({ authorization: 'Bearer v1_live_invalidkeywithbadhash12345678' })
    );
    expect(res.status).toBe(401);

    await flushAuditEvents();
    const events = await getAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      surface: 'rest',
      action: 'v1.health',
      scope: 'quotes:read',
      callerId: 'anonymous',
      callerKind: 'anonymous',
      outcome: 'denied',
      status: 401,
      intentHash: null,
    });
  });

  it('idempotent replay leaves an ok audit event with the replayed status', async () => {
    const idempotencyHeaders = { 'Idempotency-Key': 'replay-test-key-1' };

    const first = await offrampPOST(postOfframp(VALID_OFFRAMP_BODY, idempotencyHeaders));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { quoteId: string };

    const second = await offrampPOST(postOfframp(VALID_OFFRAMP_BODY, idempotencyHeaders));
    expect(second.status).toBe(200);
    expect(second.headers.get('Idempotency-Replayed')).toBe('true');

    await flushAuditEvents();
    const events = await getAuditEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      action: 'v1.intent.offramp',
      outcome: 'ok',
      status: 200,
      intentHash: firstBody.quoteId,
    });
    expect(events[1]).toMatchObject({
      action: 'v1.intent.offramp',
      outcome: 'ok',
      status: 200,
      intentHash: firstBody.quoteId,
    });
  });

  it('A store whose append rejects leaves the HTTP response identical', async () => {
    class FailingAuditStore extends InMemoryAuditStore {
      override async append(): Promise<void> {
        throw new Error('Database disk is full');
      }
    }
    _setAuditStore(new FailingAuditStore());

    const res = await offrampPOST(postOfframp(VALID_OFFRAMP_BODY));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('20');
    expect(res.headers.get('X-Request-Id')).toBeTruthy();

    const body = (await res.json()) as { quoteId: string; route: unknown };
    expect(body).toHaveProperty('quoteId');
    expect(body).toHaveProperty('route');
    expect(body.quoteId).toMatch(/^[0-9a-f]{64}$/);
  });
});
