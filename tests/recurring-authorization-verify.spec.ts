import { describe, it, expect } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { ANCHORS, VISIBLE_CORRIDORS } from '@/constants/anchors';
import { registeredAnchorsForCorridor } from '@/lib/intent/anchor-accounts';
import {
  STANDING_AUTHORIZATION_MAX_DAYS,
  hashStandingAuthorization,
  verifyStandingAuthorization,
  type StandingAuthorizationErrorCode,
  type StandingAuthorizationTerms,
} from '@/lib/recurring';

// REC002 — verifyStandingAuthorization: signature, hash and policy checks.

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-26T12:00:00.000Z');

// A visible corridor whose id matches `${from}-${to}` (the terms schema requires
// it) and that at least one registered anchor serves.
const CORRIDOR = VISIBLE_CORRIDORS.find(
  (c) => c.id === `${c.from}-${c.to}`.toLowerCase() && registeredAnchorsForCorridor(c.id).length > 0
)!;
const ANCHOR_ID = registeredAnchorsForCorridor(CORRIDOR.id)[0]!;
// A real registry anchor that does not serve the corridor.
const OUTSIDE_ANCHOR_ID = ANCHORS.find(
  (a) => !registeredAnchorsForCorridor(CORRIDOR.id).includes(a.id)
)!.id;

const iso = (ms: number) => new Date(ms).toISOString();

function baseTerms(sender: string): StandingAuthorizationTerms {
  return {
    type: 'recurring-authorization',
    version: 1,
    sender,
    corridorId: CORRIDOR.id,
    sourceAsset: CORRIDOR.from,
    destinationAsset: CORRIDOR.to,
    amount: '100',
    perPeriodCap: '500',
    period: 'weekly',
    startAt: iso(NOW.getTime()),
    stopAt: iso(NOW.getTime() + 30 * DAY_MS),
    anchorAllowlist: [ANCHOR_ID],
    nonce: '0123456789abcdef0123456789abcdef',
  };
}

type Mode = 'raw' | 'sep53';

function signHash(keypair: Keypair, hash: string, mode: Mode): string {
  // The SDK returns a Uint8Array, whose toString ignores the encoding, so wrap it.
  return mode === 'raw'
    ? Buffer.from(keypair.sign(Buffer.from(hash, 'hex'))).toString('base64')
    : Buffer.from(keypair.signMessage(hash)).toString('base64');
}

async function signed(
  overrides: Partial<StandingAuthorizationTerms> = {},
  opts: { mode?: Mode; keypair?: Keypair } = {}
) {
  const keypair = opts.keypair ?? Keypair.random();
  const terms = { ...baseTerms(keypair.publicKey()), ...overrides };
  const termsHash = await hashStandingAuthorization(terms);
  return {
    terms,
    termsHash,
    signature: signHash(keypair, termsHash, opts.mode ?? 'raw'),
    publicKey: keypair.publicKey(),
  };
}

async function expectCode(input: unknown, code: StandingAuthorizationErrorCode) {
  const res = await verifyStandingAuthorization(input, { now: NOW });
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.code).toBe(code);
    expect(typeof res.message).toBe('string');
    expect(res.message.length).toBeGreaterThan(0);
  }
  return res;
}

describe('verifyStandingAuthorization (REC002)', () => {
  it('picks a corridor, a serving anchor and an outside anchor from the registry', () => {
    expect(CORRIDOR).toBeDefined();
    expect(ANCHOR_ID).toBeTruthy();
    expect(OUTSIDE_ANCHOR_ID).toBeTruthy();
    expect(registeredAnchorsForCorridor(CORRIDOR.id)).not.toContain(OUTSIDE_ANCHOR_ID);
  });

  it('accepts a raw Ed25519 signature over the hash bytes', async () => {
    const doc = await signed({}, { mode: 'raw' });
    const res = await verifyStandingAuthorization(doc, { now: NOW });
    expect(res).toEqual({ ok: true, authorization: doc });
  });

  it('accepts a SEP-53 signMessage signature', async () => {
    const doc = await signed({}, { mode: 'sep53' });
    const res = await verifyStandingAuthorization(doc, { now: NOW });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.authorization).toEqual(doc);
  });

  it('returns invalid_payload for null input', async () => {
    await expectCode(null, 'invalid_payload');
  });

  it('returns invalid_payload with the first zod issue message', async () => {
    const doc = await signed();
    const res = await expectCode(
      { ...doc, terms: { ...doc.terms, stopAt: doc.terms.startAt } },
      'invalid_payload'
    );
    if (!res.ok) expect(res.message).toBe('stopAt must be after startAt');
  });

  it('returns hash_mismatch when perPeriodCap is tampered with and the old hash is kept', async () => {
    const doc = await signed();
    await expectCode({ ...doc, terms: { ...doc.terms, perPeriodCap: '5000' } }, 'hash_mismatch');
  });

  it('returns invalid_signature for a signature from another key', async () => {
    const doc = await signed();
    const other = Keypair.random();
    await expectCode(
      { ...doc, signature: signHash(other, doc.termsHash, 'raw') },
      'invalid_signature'
    );
  });

  it('returns unknown_corridor for a corridor id that is not in the registry', async () => {
    const doc = await signed({
      sourceAsset: 'ZZZ',
      destinationAsset: 'QQQ',
      corridorId: 'zzz-qqq',
    });
    await expectCode(doc, 'unknown_corridor');
  });

  it('returns anchor_not_in_corridor naming the anchor that does not serve the corridor', async () => {
    const doc = await signed({ anchorAllowlist: [ANCHOR_ID, OUTSIDE_ANCHOR_ID] });
    const res = await expectCode(doc, 'anchor_not_in_corridor');
    if (!res.ok) expect(res.message).toContain(OUTSIDE_ANCHOR_ID);
  });

  it('returns amount_exceeds_cap when amount is above perPeriodCap', async () => {
    await expectCode(await signed({ amount: '500.0000001' }), 'amount_exceeds_cap');
  });

  it('accepts amount equal to perPeriodCap', async () => {
    const res = await verifyStandingAuthorization(await signed({ amount: '500' }), { now: NOW });
    expect(res.ok).toBe(true);
  });

  it('returns stop_in_past when stopAt is at or before now', async () => {
    await expectCode(
      await signed({ startAt: iso(NOW.getTime() - 10 * DAY_MS), stopAt: iso(NOW.getTime()) }),
      'stop_in_past'
    );
  });

  it('returns start_too_old when startAt is more than 24h before now', async () => {
    await expectCode(
      await signed({ startAt: iso(NOW.getTime() - DAY_MS - 1000) }),
      'start_too_old'
    );
  });

  it('accepts startAt exactly 24h before now', async () => {
    const res = await verifyStandingAuthorization(
      await signed({ startAt: iso(NOW.getTime() - DAY_MS) }),
      { now: NOW }
    );
    expect(res.ok).toBe(true);
  });

  it('returns window_too_long when the window exceeds the max days', async () => {
    const start = NOW.getTime();
    await expectCode(
      await signed({
        startAt: iso(start),
        stopAt: iso(start + STANDING_AUTHORIZATION_MAX_DAYS * DAY_MS + 1000),
      }),
      'window_too_long'
    );
  });

  it('accepts a window of exactly the max days', async () => {
    const start = NOW.getTime();
    const res = await verifyStandingAuthorization(
      await signed({
        startAt: iso(start),
        stopAt: iso(start + STANDING_AUTHORIZATION_MAX_DAYS * DAY_MS),
      }),
      { now: NOW }
    );
    expect(res.ok).toBe(true);
  });

  it('runs the checks in order: hash before signature before policy', async () => {
    // Signed terms that break policy (amount above cap).
    const doc = await signed({ amount: '600' });
    await expectCode(doc, 'amount_exceeds_cap');
    // A bad signature wins over the policy failure.
    const other = Keypair.random();
    await expectCode(
      { ...doc, signature: signHash(other, doc.termsHash, 'raw') },
      'invalid_signature'
    );
    // A stale hash wins over both.
    await expectCode(
      {
        ...doc,
        terms: { ...doc.terms, nonce: 'f'.repeat(32) },
        signature: signHash(other, doc.termsHash, 'raw'),
      },
      'hash_mismatch'
    );
  });

  it('does not throw on hostile input', async () => {
    const hostile = {
      get terms() {
        throw new Error('boom');
      },
    };
    await expectCode(hostile, 'invalid_payload');
  });
});
