import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { ANCHORS, VISIBLE_CORRIDORS } from '@/constants/anchors';
import { POST as createPOST } from '@/app/api/recurring/route';
import { GET as readGET } from '@/app/api/recurring/[id]/route';
import { GET as dueGET } from '@/app/api/recurring/due/route';
import { POST as controlPOST } from '@/app/api/recurring/[id]/control/route';
import { POST as executePOST } from '@/app/api/recurring/[id]/executions/route';
import { flags } from '@/lib/flags';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { clearIntentReplayStore } from '@/lib/intent/replay';
import { hashIntent } from '@/lib/intent/hash';
import { registeredAnchorsForCorridor } from '@/lib/intent/anchor-accounts';
import {
  InMemoryStandingAuthorizationStore,
  _setStandingAuthorizationStore,
  hashStandingAuthorization,
  type StandingAuthorizationTerms,
} from '@/lib/recurring';
import type { RecurringControl } from '@/lib/recurring/control';
import type { RecurringExecutionIntent } from '@/lib/recurring/execution';

// REC013 — one standing order walked through its whole life, for every live
// corridor, against the real route handlers. The only seams are the store,
// limiter and replay resets and the fake clock.

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-04-06T08:00:00.000Z');
const BASE = 'http://localhost/api/recurring';

let corridorsRun = 0;
const prevFlag = flags.recurringIntents;

beforeEach(() => {
  flags.recurringIntents = true;
  _setStandingAuthorizationStore(new InMemoryStandingAuthorizationStore());
  clearRateLimitStore();
  clearIntentReplayStore();
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
  flags.recurringIntents = prevFlag;
  _setStandingAuthorizationStore(null);
  clearRateLimitStore();
  clearIntentReplayStore();
});

const iso = (ms: number) => new Date(ms).toISOString();

function json(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe.each(VISIBLE_CORRIDORS.map((c) => [c.id]))(
  'standing order lifecycle: %s',
  (corridorId) => {
    const corridor = VISIBLE_CORRIDORS.find((c) => c.id === corridorId)!;
    const anchorId = registeredAnchorsForCorridor(corridorId)[0];
    const outsideAnchorId = ANCHORS.find((a) => a.id !== anchorId)!.id;
    const sender = Keypair.random();

    async function createOrder(
      stopAt: number
    ): Promise<{ id: string; terms: StandingAuthorizationTerms }> {
      const terms: StandingAuthorizationTerms = {
        type: 'recurring-authorization',
        version: 1,
        sender: sender.publicKey(),
        corridorId,
        sourceAsset: corridor.from,
        destinationAsset: corridor.to,
        amount: '50',
        perPeriodCap: '80',
        period: 'weekly',
        startAt: iso(Date.now()),
        stopAt: iso(stopAt),
        anchorAllowlist: [anchorId!],
        nonce: randomBytes(16).toString('hex'),
      };
      const termsHash = await hashStandingAuthorization(terms);
      const signature = Buffer.from(sender.sign(Buffer.from(termsHash, 'hex'))).toString('base64');
      const res = await createPOST(
        json(BASE, { terms, termsHash, signature, publicKey: sender.publicKey() })
      );
      expect(res.status).toBe(201);
      return { id: (await res.json()).id, terms };
    }

    async function dueIds(
      id: string
    ): Promise<Array<{ authorizationId: string; cycleNumber: number }>> {
      const res = await dueGET(new NextRequest(`${BASE}/due?ids=${id}`));
      expect(res.status).toBe(200);
      return (await res.json()).reminders;
    }

    async function phase(id: string): Promise<string> {
      const res = await readGET(new NextRequest(`${BASE}/${id}`), {
        params: Promise.resolve({ id }),
      });
      expect(res.status).toBe(200);
      return (await res.json()).state.phase;
    }

    async function confirm(
      id: string,
      cycleNumber: number,
      overrides: Partial<RecurringExecutionIntent> = {}
    ): Promise<{ status: number; code?: string }> {
      const intent: RecurringExecutionIntent = {
        type: 'offramp-outcome',
        sourceAsset: corridor.from,
        destinationAsset: corridor.to,
        amount: '50',
        sender: sender.publicKey(),
        recipient: overrides.anchorId ?? anchorId!,
        anchorId: anchorId!,
        corridor: corridorId,
        transactionId: `tx-${randomUUID()}`,
        recurringAuthorizationId: id,
        cycleNumber,
        ...overrides,
      };
      const intentHash = await hashIntent(intent);
      const signature = Buffer.from(sender.sign(Buffer.from(intentHash, 'hex'))).toString('base64');
      const res = await executePOST(
        json(`${BASE}/${id}/executions`, { intent, signature, publicKey: sender.publicKey() }),
        { params: Promise.resolve({ id }) }
      );
      return { status: res.status, code: (await res.json()).code };
    }

    async function control(
      id: string,
      terms: StandingAuthorizationTerms,
      action: RecurringControl['action']
    ): Promise<number> {
      const msg: RecurringControl = {
        type: 'recurring-control',
        action,
        authorizationId: id,
        sender: sender.publicKey(),
        sourceAsset: terms.sourceAsset,
        destinationAsset: terms.destinationAsset,
        amount: terms.amount,
        nonce: randomBytes(16).toString('hex'),
        deadline: iso(Date.now() + 60_000),
      };
      const hash = await hashIntent(msg);
      const signature = Buffer.from(sender.sign(Buffer.from(hash, 'hex'))).toString('base64');
      const res = await controlPOST(
        json(`${BASE}/${id}/control`, { control: msg, signature, publicKey: sender.publicKey() }),
        { params: Promise.resolve({ id }) }
      );
      return res.status;
    }

    const run = anchorId ? it : it.skip;
    const title = anchorId
      ? `create, due, confirm, cap breach, pause, cancel and stop date via ${anchorId}`
      : `skipped: no registered anchor serves ${corridorId}`;

    run(title, async () => {
      corridorsRun += 1;

      // 1. A weekly order, 50 per payment, capped at 80 per week, stopping in 3 weeks.
      const { id, terms } = await createOrder(START + 21 * DAY_MS);

      // 2. Cycle 1 is due.
      const firstDue = await dueIds(id);
      expect(firstDue).toHaveLength(1);
      expect(firstDue[0]).toMatchObject({ authorizationId: id, cycleNumber: 1 });

      // 3. Confirm cycle 1.
      expect(await confirm(id, 1)).toEqual({ status: 201, code: undefined });

      // 4. Nothing is due for the rest of the week.
      expect(await dueIds(id)).toEqual([]);
      expect(await phase(id)).toBe('confirmed_this_period');

      // 5. A week later: 90 breaches the cap of 80; 80 is accepted.
      vi.setSystemTime(START + 7 * DAY_MS);
      expect(await confirm(id, 2, { amount: '90' })).toEqual({
        status: 422,
        code: 'PERIOD_CAP_EXCEEDED',
      });
      expect((await confirm(id, 2, { amount: '80' })).status).toBe(201);

      // 6. Paused orders are never due; resume brings the order back.
      expect(await control(id, terms, 'pause')).toBe(200);
      expect(await dueIds(id)).toEqual([]);
      expect(await control(id, terms, 'resume')).toBe(200);

      // 7. A week later, an anchor outside the allowlist is rejected.
      vi.setSystemTime(START + 14 * DAY_MS);
      expect(await dueIds(id)).toHaveLength(1);
      expect(
        await confirm(id, 3, { anchorId: outsideAnchorId, recipient: outsideAnchorId })
      ).toEqual({ status: 422, code: 'ANCHOR_NOT_ALLOWED' });

      // 8. Past stopAt the order is completed and nothing can be confirmed.
      vi.setSystemTime(START + 21 * DAY_MS);
      expect(await phase(id)).toBe('completed');
      expect(await confirm(id, 3)).toEqual({ status: 409, code: 'NOT_DUE' });

      // 9. A cancelled order cannot be resumed.
      const second = await createOrder(Date.now() + 21 * DAY_MS);
      expect(await control(second.id, second.terms, 'cancel')).toBe(200);
      expect(await control(second.id, second.terms, 'resume')).toBe(409);
    });
  }
);

// Defined last, so it runs after every corridor above.
it('ran the lifecycle for at least one live corridor', () => {
  expect(corridorsRun).toBeGreaterThan(0);
});
