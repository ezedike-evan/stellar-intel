/**
 * Reputation end-to-end: append then query.
 *
 * Flow:
 *  1. Open an in-memory SQLite database (the "SQLite backend").
 *  2. Redact a raw intent to produce a safe OutcomeRow.
 *  3. Append the row to the store (simulating a mocked terminal event).
 *  4. Query the scorecard via buildScorecards.
 *  5. Assert the round-trip: the appended row is visible in the aggregate.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, appendRow, queryRows } from '@/lib/reputation/db';
import { redactIntent, type RawIntent } from '@/lib/reputation/redact';
import { buildScorecards } from '@/lib/reputation/aggregate';
import type { OutcomeRow } from '@/lib/reputation/aggregate';
import type { ReputationDb } from '@/lib/reputation/db';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date('2025-06-01T00:00:00Z').getTime();
const daysAgo = (d: number): number => NOW - d * 86_400_000;

function makeRawIntent(overrides: Partial<RawIntent> = {}): RawIntent {
  return {
    recipientAccount: 'GABCDE12345XYZ',
    recipientName: 'Alice Testuser',
    recipientEmail: 'alice@example.com',
    recipientPhone: '+2348000000001',
    bankAccount: '0123456789',
    account: 'GABCDE12345XYZ',
    amount: '100',
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    corridorId: 'usdc-ngn',
    anchorId: 'anchor-test',
    ...overrides,
  };
}

function makeOutcomeRow(
  redacted: ReturnType<typeof redactIntent>,
  overrides: Partial<OutcomeRow> = {}
): OutcomeRow {
  return {
    intentHash: redacted.intentHash,
    anchorId: redacted.anchorId,
    filled: true,
    settleMs: 4_500,
    slippage: 0.012,
    recordedAt: daysAgo(1),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('reputation e2e — append then query', () => {
  let db: ReputationDb;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('round trip: appended row is visible in the 7-day scorecard', () => {
    const intent = makeRawIntent();
    const redacted = redactIntent(intent);
    const row = makeOutcomeRow(redacted);

    // ── Append ──
    appendRow(db, row);

    // ── Query ──
    const rows = queryRows(db, 'anchor-test');
    const scorecards = buildScorecards(rows, NOW);

    // ── Assert round trip ──
    expect(scorecards[7].state).toBe('ok');
    if (scorecards[7].state !== 'ok') return;

    expect(scorecards[7].sampleSize).toBe(1);
    expect(scorecards[7].fillRate).toBe(1);
    expect(scorecards[7].settleMs.p50).toBe(4_500);
    expect(scorecards[7].slippage.p50).toBe(0.012);
  });

  it('appended row does not appear for a different anchorId', () => {
    const row = makeOutcomeRow(redactIntent(makeRawIntent({ anchorId: 'anchor-a' })));
    appendRow(db, row);

    const rows = queryRows(db, 'anchor-b');
    const scorecards = buildScorecards(rows, NOW);

    expect(scorecards[7].state).toBe('insufficient_data');
    expect(scorecards[30].state).toBe('insufficient_data');
    expect(scorecards[90].state).toBe('insufficient_data');
  });

  it('unfilled row reduces fill rate below 1', () => {
    const anchor = 'anchor-fill-test';
    const intentA = makeRawIntent({ anchorId: anchor, amount: '50' });
    const intentB = makeRawIntent({ anchorId: anchor, amount: '75' });

    appendRow(db, makeOutcomeRow(redactIntent(intentA), { filled: true, recordedAt: daysAgo(1) }));
    appendRow(db, makeOutcomeRow(redactIntent(intentB), { filled: false, recordedAt: daysAgo(2) }));

    const scorecards = buildScorecards(queryRows(db, anchor), NOW);
    expect(scorecards[7].state).toBe('ok');
    if (scorecards[7].state !== 'ok') return;
    expect(scorecards[7].fillRate).toBeCloseTo(0.5, 5);
  });

  it('row recorded outside the 7-day window only appears in 30 and 90-day scorecards', () => {
    const anchor = 'anchor-window-test';
    const row = makeOutcomeRow(redactIntent(makeRawIntent({ anchorId: anchor })), {
      recordedAt: daysAgo(20), // within 30 & 90 days but NOT 7 days
    });
    appendRow(db, row);

    const scorecards = buildScorecards(queryRows(db, anchor), NOW);
    expect(scorecards[7].state).toBe('insufficient_data');
    expect(scorecards[30].state).toBe('ok');
    expect(scorecards[90].state).toBe('ok');
  });

  it('idempotent append — inserting the same intentHash twice does not double-count', () => {
    const anchor = 'anchor-idempotent';
    const redacted = redactIntent(makeRawIntent({ anchorId: anchor }));
    const row = makeOutcomeRow(redacted);

    appendRow(db, row);
    appendRow(db, row); // same intentHash — INSERT OR REPLACE

    const scorecards = buildScorecards(queryRows(db, anchor), NOW);
    expect(scorecards[7].state).toBe('ok');
    if (scorecards[7].state !== 'ok') return;
    expect(scorecards[7].sampleSize).toBe(1); // still just one row
  });

  it('PII is not stored — raw intent fields absent from DB row', () => {
    const intent = makeRawIntent();
    const redacted = redactIntent(intent);
    appendRow(db, makeOutcomeRow(redacted));

    const [stored] = queryRows(db, 'anchor-test') as unknown as Array<Record<string, unknown>>;
    expect(stored).not.toHaveProperty('recipientAccount');
    expect(stored).not.toHaveProperty('recipientName');
    expect(stored).not.toHaveProperty('recipientEmail');
    expect(stored).not.toHaveProperty('recipientPhone');
    expect(stored).not.toHaveProperty('bankAccount');
    expect(stored).not.toHaveProperty('account');
    expect(stored).toHaveProperty('intentHash');
  });

  it('multiple anchors are isolated from each other', () => {
    for (const anchorId of ['anchor-x', 'anchor-y', 'anchor-z']) {
      for (let i = 0; i < 3; i++) {
        const redacted = redactIntent(makeRawIntent({ anchorId, amount: String(i * 10 + 1) }));
        appendRow(db, makeOutcomeRow(redacted, { anchorId, recordedAt: daysAgo(i + 1) }));
      }
    }

    for (const anchorId of ['anchor-x', 'anchor-y', 'anchor-z']) {
      const scorecards = buildScorecards(queryRows(db, anchorId), NOW);
      expect(scorecards[7].state).toBe('ok');
      if (scorecards[7].state !== 'ok') continue;
      expect(scorecards[7].sampleSize).toBe(3);
    }
  });
});
