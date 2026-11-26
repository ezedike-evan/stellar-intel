import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { POST as createPOST } from '@/app/api/recurring/route';
import { GET as readGET } from '@/app/api/recurring/[id]/route';
import { GET as dueGET } from '@/app/api/recurring/due/route';
import { flags } from '@/lib/flags';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { ANCHORS, VISIBLE_CORRIDORS } from '@/constants/anchors';
import { registeredAnchorsForCorridor } from '@/lib/intent/anchor-accounts';
import {
  InMemoryStandingAuthorizationStore,
  _setStandingAuthorizationStore,
  hashStandingAuthorization,
  type StandingAuthorizationTerms,
} from '@/lib/recurring';

// REC007 — flag-gated routes to create, read and list due standing orders.

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = 'http://localhost/api/recurring';

const CORRIDOR = VISIBLE_CORRIDORS.find(
  (c) => c.id === `${c.from}-${c.to}`.toLowerCase() && registeredAnchorsForCorridor(c.id).length > 0
)!;
const ANCHOR_ID = registeredAnchorsForCorridor(CORRIDOR.id)[0]!;
const OUTSIDE_ANCHOR_ID = ANCHORS.find(
  (a) => !registeredAnchorsForCorridor(CORRIDOR.id).includes(a.id)
)!.id;

let store: InMemoryStandingAuthorizationStore;

beforeEach(() => {
  clearRateLimitStore();
  store = new InMemoryStandingAuthorizationStore();
  _setStandingAuthorizationStore(store);
  flags.recurringIntents = true;
});

afterEach(() => {
  flags.recurringIntents = false;
  _setStandingAuthorizationStore(null);
});

const iso = (ms: number) => new Date(ms).toISOString();

async function signedDoc(overrides: Partial<StandingAuthorizationTerms> = {}) {
  const keypair = Keypair.random();
  const now = Date.now();
  const terms: StandingAuthorizationTerms = {
    type: 'recurring-authorization',
    version: 1,
    sender: keypair.publicKey(),
    corridorId: CORRIDOR.id,
    sourceAsset: CORRIDOR.from,
    destinationAsset: CORRIDOR.to,
    amount: '100',
    perPeriodCap: '500',
    period: 'weekly',
    startAt: iso(now),
    stopAt: iso(now + 60 * DAY_MS),
    anchorAllowlist: [ANCHOR_ID],
    nonce: randomUUID().replace(/-/g, ''),
    ...overrides,
  };
  const termsHash = await hashStandingAuthorization(terms);
  const signature = Buffer.from(keypair.sign(Buffer.from(termsHash, 'hex'))).toString('base64');
  return { terms, termsHash, signature, publicKey: keypair.publicKey() };
}

function postReq(body: unknown): NextRequest {
  return new NextRequest(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function read(id: string) {
  return readGET(new NextRequest(`${BASE}/${id}`), { params: Promise.resolve({ id }) });
}

function due(ids?: string) {
  const url = ids === undefined ? `${BASE}/due` : `${BASE}/due?ids=${ids}`;
  return dueGET(new NextRequest(url));
}

async function create(doc: unknown) {
  const res = await createPOST(postReq(doc));
  return { res, body: await res.json() };
}

describe('recurring routes are flag-gated (REC007)', () => {
  it('returns 404 NOT_FOUND on all three routes with the flag off', async () => {
    flags.recurringIntents = false;
    const doc = await signedDoc();
    const id = randomUUID();

    const responses = [await createPOST(postReq(doc)), await read(id), await due(id)];
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
    }
    expect(await store.get(id)).toBeNull();
  });
});

describe('POST /api/recurring', () => {
  it('creates an authorization (201) that is due when startAt is now', async () => {
    const doc = await signedDoc();
    const { res, body } = await create(doc);

    expect(res.status).toBe(201);
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.termsHash).toBe(doc.termsHash);
    expect(body.state.phase).toBe('due');
    expect(body.state.due.authorizationId).toBe(body.id);
    expect(body.state.due.amount).toBe('100');

    const stored = await store.get(body.id);
    expect(stored?.status).toBe('active');
    expect(stored?.authorization).toEqual(doc);
  });

  it('returns 400 INVALID_JSON for a body that is not JSON', async () => {
    const res = await createPOST(postReq('{not json'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_JSON');
  });

  it('returns 400 VALIDATION_ERROR for an invalid payload', async () => {
    const { res, body } = await create({ terms: {} });
    expect(res.status).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 UNAUTHORIZED for tampered terms', async () => {
    const doc = await signedDoc();
    const { res, body } = await create({ ...doc, terms: { ...doc.terms, perPeriodCap: '5000' } });
    expect(res.status).toBe(401);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 UNAUTHORIZED for a signature from another key', async () => {
    const doc = await signedDoc();
    const other = Keypair.random();
    const signature = Buffer.from(other.sign(Buffer.from(doc.termsHash, 'hex'))).toString('base64');
    const { res, body } = await create({ ...doc, signature });
    expect(res.status).toBe(401);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('returns 422 ANCHOR_NOT_IN_CORRIDOR for an allowlist anchor outside the corridor', async () => {
    const doc = await signedDoc({ anchorAllowlist: [ANCHOR_ID, OUTSIDE_ANCHOR_ID] });
    const { res, body } = await create(doc);
    expect(res.status).toBe(422);
    expect(body.code).toBe('ANCHOR_NOT_IN_CORRIDOR');
    expect(body.message).toContain(OUTSIDE_ANCHOR_ID);
  });

  it('returns 409 DUPLICATE_AUTHORIZATION when the same document is re-submitted', async () => {
    const doc = await signedDoc();
    const first = await create(doc);
    expect(first.res.status).toBe(201);

    const second = await create(doc);
    expect(second.res.status).toBe(409);
    expect(second.body.code).toBe('DUPLICATE_AUTHORIZATION');
  });
});

describe('GET /api/recurring/{id}', () => {
  it('returns terms, status, state and executions, and no signature', async () => {
    const doc = await signedDoc();
    const { body: created } = await create(doc);

    const execution = {
      id: randomUUID(),
      authorizationId: created.id,
      cycleNumber: 1,
      periodIndex: 0,
      amount: '100',
      anchorId: ANCHOR_ID,
      intentHash: 'c'.repeat(64),
      transactionId: 'tx-1',
      status: 'confirmed' as const,
      rejectCode: null,
      createdAt: new Date().toISOString(),
    };
    await store.appendExecution(execution);

    const res = await read(created.id);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.id).toBe(created.id);
    expect(body.termsHash).toBe(doc.termsHash);
    expect(body.terms).toEqual(doc.terms);
    expect(body.status).toBe('active');
    expect(body.state.phase).toBe('confirmed_this_period');
    expect(body.executions).toEqual([execution]);
    expect(body).not.toHaveProperty('signature');
    expect(JSON.stringify(body)).not.toContain(doc.signature);
  });

  it('returns 404 NOT_FOUND for an id that is not a UUID', async () => {
    const res = await read('not-a-uuid');
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NOT_FOUND');
  });

  it('returns 404 NOT_FOUND for an unknown UUID', async () => {
    const res = await read(randomUUID());
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NOT_FOUND');
  });
});

describe('GET /api/recurring/due', () => {
  it('returns 400 VALIDATION_ERROR when ids is missing', async () => {
    const res = await due();
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for 21 ids', async () => {
    const ids = Array.from({ length: 21 }, () => randomUUID()).join(',');
    const res = await due(ids);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when any id is not a UUID', async () => {
    const res = await due(`${randomUUID()},nope`);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns only due reminders and skips unknown ids', async () => {
    const dueNow = await create(await signedDoc());
    const later = Date.now() + 2 * DAY_MS;
    const scheduled = await create(
      await signedDoc({ startAt: iso(later), stopAt: iso(later + 30 * DAY_MS) })
    );
    expect(dueNow.body.state.phase).toBe('due');
    expect(scheduled.body.state.phase).toBe('scheduled');

    const res = await due([dueNow.body.id, scheduled.body.id, randomUUID()].join(','));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reminders).toHaveLength(1);
    expect(body.reminders[0].authorizationId).toBe(dueNow.body.id);
    expect(body.reminders[0].termsHash).toBe(dueNow.body.termsHash);
  });
});
