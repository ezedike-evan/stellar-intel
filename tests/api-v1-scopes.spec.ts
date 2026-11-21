import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { flags } from '@/lib/flags';
import { generateApiKey } from '@/lib/auth/api-keys';
import { InMemoryApiKeyStore, _setApiKeyStore, type ApiKeyRecord } from '@/lib/auth/key-store';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { clearIdempotencyStore } from '@/lib/api/v1';
import { POST as offrampPOST } from '@/app/api/v1/intent/offramp/route';
import { GET as healthGET } from '@/app/api/v1/health/route';
import * as offrampModule from '@/lib/intent/offramp';

const VALID_OFFRAMP_BODY = {
  type: 'offramp',
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '100',
  sender: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  recipient: 'NGN-BANK-ACCOUNT-123',
};

function postIntent(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/intent/offramp', {
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

describe('v1 scope enforcement and requireKeyForWrites flag (#2201)', () => {
  let store: InMemoryApiKeyStore;
  const originalRequireKeyForWrites = flags.requireKeyForWrites;

  beforeEach(() => {
    flags.requireKeyForWrites = false;
    clearRateLimitStore();
    clearIdempotencyStore();
    store = new InMemoryApiKeyStore();
    _setApiKeyStore(store);

    vi.stubEnv(
      'ANCHOR_PAYMENT_ACCOUNTS',
      JSON.stringify({ moneygram: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' })
    );
  });

  afterEach(() => {
    flags.requireKeyForWrites = originalRequireKeyForWrites;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('flag off: anonymous POST /api/v1/intent/offramp returns 200', async () => {
    const res = await offrampPOST(postIntent(VALID_OFFRAMP_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('quoteId');
  });

  it('key with only quotes:read gets 403 with WWW-Authenticate on intent, and 200 on health', async () => {
    const key = await generateApiKey();
    await store.create({
      keyId: key.keyId,
      displayPrefix: key.displayPrefix,
      hash: key.hash,
      name: 'Read-only key',
      scopes: ['quotes:read'],
      tier: 'standard',
      maxIntentAmount: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });

    const offrampRes = await offrampPOST(
      postIntent(VALID_OFFRAMP_BODY, { authorization: `Bearer ${key.key}` })
    );
    expect(offrampRes.status).toBe(403);
    expect(offrampRes.headers.get('WWW-Authenticate')).toBe(
      'Bearer error="insufficient_scope", scope="intents:write"'
    );
    const offrampJson = await offrampRes.json();
    expect(offrampJson.error.code).toBe('insufficient_scope');
    expect(offrampJson.error.message).toContain('intents:write');

    const healthRes = await healthGET(getHealth({ authorization: `Bearer ${key.key}` }));
    expect(healthRes.status).toBe(200);
  });

  it('admin key gets 200 on both intent and health', async () => {
    const key = await generateApiKey();
    await store.create({
      keyId: key.keyId,
      displayPrefix: key.displayPrefix,
      hash: key.hash,
      name: 'Admin key',
      scopes: ['admin'],
      tier: 'standard',
      maxIntentAmount: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });

    const offrampRes = await offrampPOST(
      postIntent(VALID_OFFRAMP_BODY, { authorization: `Bearer ${key.key}` })
    );
    expect(offrampRes.status).toBe(200);

    const healthRes = await healthGET(getHealth({ authorization: `Bearer ${key.key}` }));
    expect(healthRes.status).toBe(200);
  });

  it('flag on: anonymous intent returns 403, anonymous health returns 200, key with intents:write gets 200', async () => {
    flags.requireKeyForWrites = true;

    // Anonymous intent blocked
    const anonIntentRes = await offrampPOST(postIntent(VALID_OFFRAMP_BODY));
    expect(anonIntentRes.status).toBe(403);
    expect(anonIntentRes.headers.get('WWW-Authenticate')).toBe(
      'Bearer error="insufficient_scope", scope="intents:write"'
    );

    // Anonymous health allowed
    const anonHealthRes = await healthGET(getHealth());
    expect(anonHealthRes.status).toBe(200);

    // Key with intents:write succeeds
    const key = await generateApiKey();
    await store.create({
      keyId: key.keyId,
      displayPrefix: key.displayPrefix,
      hash: key.hash,
      name: 'Write key',
      scopes: ['quotes:read', 'intents:write'],
      tier: 'standard',
      maxIntentAmount: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });

    const keyedIntentRes = await offrampPOST(
      postIntent(VALID_OFFRAMP_BODY, { authorization: `Bearer ${key.key}` })
    );
    expect(keyedIntentRes.status).toBe(200);
  });

  it('the 403 path never reaches createOfframpIntent (spy)', async () => {
    const spy = vi.spyOn(offrampModule, 'createOfframpIntent');

    flags.requireKeyForWrites = true;
    const res = await offrampPOST(postIntent(VALID_OFFRAMP_BODY));
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
});
