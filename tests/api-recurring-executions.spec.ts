import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { POST as createPOST } from '@/app/api/recurring/route';
import { POST as executePOST } from '@/app/api/recurring/[id]/executions/route';
import { flags } from '@/lib/flags';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { hashIntent } from '@/lib/intent/hash';
import { ANCHORS, VISIBLE_CORRIDORS } from '@/constants/anchors';
import { registeredAnchorsForCorridor } from '@/lib/intent/anchor-accounts';
import {
  InMemoryStandingAuthorizationStore,
  _setStandingAuthorizationStore,
  hashStandingAuthorization,
  type StandingAuthorizationTerms,
} from '@/lib/recurring';
import type { RecurringExecutionIntent } from '@/lib/recurring/execution';

// REC009 — confirm a due standing-order payment with one signature.

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-03-02T09:00:00.000Z');
const BASE = 'http://localhost/api/recurring';

const CORRIDOR = VISIBLE_CORRIDORS.find(
  (c) => c.id === `${c.from}-${c.to}`.toLowerCase() && registeredAnchorsForCorridor(c.id).length > 0
)!;
const ANCHOR_ID = registeredAnchorsForCorridor(CORRIDOR.id)[0]!;
const OUTSIDE_ANCHOR_ID = ANCHORS.find(
  (a) => !registeredAnchorsForCorridor(CORRIDOR.id).includes(a.id)
)!.id;

let store: InMemoryStandingAuthorizationStore;
let sender: Keypair;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
  clearRateLimitStore();
  store = new InMemoryStandingAuthorizationStore();
  _setStandingAuthorizationStore(store);
  flags.recurringIntents = true;
  sender = Keypair.random();
});

afterEach(() => {
  flags.recurringIntents = false;
  _setStandingAuthorizationStore(null);
  vi.useRealTimers();
});

const iso = (ms: number) => new Date(ms).toISOString();

async function createOrder(overrides: Partial<StandingAuthorizationTerms> = {}): Promise<string> {
  const terms: StandingAuthorizationTerms = {
    type: 'recurring-authorization',
    version: 1,
    sender: sender.publicKey(),
    corridorId: CORRIDOR.id,
    sourceAsset: CORRIDOR.from,
    destinationAsset: CORRIDOR.to,
    amount: '100',
    perPeriodCap: '500',
    period: 'weekly',
    startAt: iso(START),
    stopAt: iso(START + 21 * DAY_MS),
    anchorAllowlist: [ANCHOR_ID],
    nonce: randomUUID().replace(/-/g, ''),
    ...overrides,
  };
  const termsHash = await hashStandingAuthorization(terms);
  const signature = Buffer.from(sender.sign(Buffer.from(termsHash, 'hex'))).toString('base64');
  const res = await createPOST(
    new NextRequest(BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ terms, termsHash, signature, publicKey: sender.publicKey() }),
    })
  );
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}

function executionIntent(
  id: string,
  overrides: Partial<RecurringExecutionIntent> = {}
): RecurringExecutionIntent {
  return {
    type: 'offramp-outcome',
    sourceAsset: CORRIDOR.from,
    destinationAsset: CORRIDOR.to,
    amount: '100',
    sender: sender.publicKey(),
    recipient: ANCHOR_ID,
    anchorId: ANCHOR_ID,
    corridor: CORRIDOR.id,
    transactionId: `tx-${randomUUID()}`,
    recurringAuthorizationId: id,
    cycleNumber: 1,
    ...overrides,
  };
}

async function signedBody(intent: RecurringExecutionIntent, signer: Keypair = sender) {
  const intentHash = await hashIntent(intent);
  const signature = Buffer.from(signer.sign(Buffer.from(intentHash, 'hex'))).toString('base64');
  return { intent, signature, publicKey: sender.publicKey() };
}

async function execute(id: string, body: unknown) {
  const res = await executePOST(
    new NextRequest(`${BASE}/${id}/executions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
  return { status: res.status, body: await res.json() };
}

describe('POST /api/recurring/[id]/executions (REC009)', () => {
  it('confirms the due cycle (201), after which the phase is confirmed_this_period', async () => {
    const id = await createOrder();
    const { status, body } = await execute(id, await signedBody(executionIntent(id)));

    expect(status).toBe(201);
    expect(body.execution).toMatchObject({
      authorizationId: id,
      cycleNumber: 1,
      periodIndex: 0,
      amount: '100',
      anchorId: ANCHOR_ID,
      status: 'confirmed',
      rejectCode: null,
    });
    expect(body.state.phase).toBe('confirmed_this_period');
    expect(await store.listExecutions(id)).toHaveLength(1);
  });

  it('answers the same body again with 200 and the same record', async () => {
    const id = await createOrder();
    const payload = await signedBody(executionIntent(id));

    const first = await execute(id, payload);
    expect(first.status).toBe(201);
    const again = await execute(id, payload);

    expect(again.status).toBe(200);
    expect(again.body.execution).toEqual(first.body.execution);
    expect(await store.listExecutions(id)).toHaveLength(1);
  });

  it('gives 409 NOT_DUE for a second, different intent for the same cycle', async () => {
    const id = await createOrder();
    expect((await execute(id, await signedBody(executionIntent(id)))).status).toBe(201);

    const second = await execute(id, await signedBody(executionIntent(id, { amount: '50' })));
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('NOT_DUE');
    expect(second.body.message).toContain('confirmed_this_period');
  });

  it('gives 422 ANCHOR_NOT_ALLOWED for a non-allowlisted anchor and stores a rejected row', async () => {
    const id = await createOrder();
    const intent = executionIntent(id, {
      anchorId: OUTSIDE_ANCHOR_ID,
      recipient: OUTSIDE_ANCHOR_ID,
    });
    const { status, body } = await execute(id, await signedBody(intent));

    expect(status).toBe(422);
    expect(body.code).toBe('ANCHOR_NOT_ALLOWED');
    const rows = await store.listExecutions(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'rejected',
      rejectCode: 'anchor_not_allowed',
      anchorId: OUTSIDE_ANCHOR_ID,
      cycleNumber: 1,
    });
  });

  it('gives 422 PERIOD_CAP_EXCEEDED for an amount over the cap', async () => {
    const id = await createOrder();
    const { status, body } = await execute(
      id,
      await signedBody(executionIntent(id, { amount: '500.0000001' }))
    );

    expect(status).toBe(422);
    expect(body.code).toBe('PERIOD_CAP_EXCEEDED');
    const rows = await store.listExecutions(id);
    expect(rows.map((r) => r.status)).toEqual(['rejected']);
  });

  it('gives 409 CYCLE_MISMATCH for a cycle that is not the due one', async () => {
    const id = await createOrder();
    const { status, body } = await execute(
      id,
      await signedBody(executionIntent(id, { cycleNumber: 2 }))
    );

    expect(status).toBe(409);
    expect(body.code).toBe('CYCLE_MISMATCH');
    expect(await store.listExecutions(id)).toHaveLength(0);
  });

  it('gives 409 NOT_DUE while the order is paused', async () => {
    const id = await createOrder();
    await store.setStatus(id, 'paused', iso(Date.now()));

    const { status, body } = await execute(id, await signedBody(executionIntent(id)));
    expect(status).toBe(409);
    expect(body.code).toBe('NOT_DUE');
    expect(body.message).toContain('paused');
  });

  it('gives 409 NOT_DUE with completed in the message after stopAt', async () => {
    const id = await createOrder();
    vi.setSystemTime(START + 21 * DAY_MS);

    const { status, body } = await execute(
      id,
      await signedBody(executionIntent(id, { cycleNumber: 3 }))
    );
    expect(status).toBe(409);
    expect(body.code).toBe('NOT_DUE');
    expect(body.message).toContain('completed');
  });

  it('gives 401 for a signature from a foreign key', async () => {
    const id = await createOrder();
    const { status, body } = await execute(
      id,
      await signedBody(executionIntent(id), Keypair.random())
    );

    expect(status).toBe(401);
    expect(body.code).toBe('UNAUTHORIZED');
    expect(await store.listExecutions(id)).toHaveLength(0);
  });

  it('gives 403 when the intent names another authorization', async () => {
    const id = await createOrder();
    const { status, body } = await execute(
      id,
      await signedBody(executionIntent(id, { recurringAuthorizationId: randomUUID() }))
    );

    expect(status).toBe(403);
    expect(body.code).toBe('FORBIDDEN');
  });

  it('gives 403 when the signer is not the sender of the terms', async () => {
    const id = await createOrder();
    const other = Keypair.random();
    const intent = executionIntent(id, { sender: other.publicKey() });
    const intentHash = await hashIntent(intent);
    const signature = Buffer.from(other.sign(Buffer.from(intentHash, 'hex'))).toString('base64');

    const { status, body } = await execute(id, {
      intent,
      signature,
      publicKey: other.publicKey(),
    });
    expect(status).toBe(403);
    expect(body.code).toBe('FORBIDDEN');
  });

  it('gives 400 VALIDATION_ERROR for a body that fails the schema', async () => {
    const id = await createOrder();
    const payload = await signedBody(executionIntent(id));
    const { status, body } = await execute(id, {
      ...payload,
      intent: { ...payload.intent, extra: 'field' },
    });

    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('gives 404 for an unknown id', async () => {
    const id = randomUUID();
    const { status, body } = await execute(id, await signedBody(executionIntent(id)));
    expect(status).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('gives 404 with the flag off', async () => {
    const id = await createOrder();
    flags.recurringIntents = false;

    const { status, body } = await execute(id, await signedBody(executionIntent(id)));
    expect(status).toBe(404);
    expect(body).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
    expect(await store.listExecutions(id)).toHaveLength(0);
  });
});
