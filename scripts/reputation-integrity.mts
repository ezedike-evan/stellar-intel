#!/usr/bin/env node
/**
 * Reputation aggregate integrity check (#962).
 *
 * The nightly workflow has had a `reputation-integrity` job since it was
 * written, running this file `if [ -f ]`. The file did not exist, so the job
 * took the `else` branch every night and reported integrity as healthy without
 * checking anything.
 *
 * What it checks are **invariants**, not values: properties that must hold for
 * any input, so the check does not need updating when the scoring weights move.
 * They run against a committed fixture rather than live data, deliberately —
 * the nightly must not go red because a third-party anchor was unreachable.
 *
 *   npx tsx scripts/reputation-integrity.mts
 *
 * Exits non-zero on the first violated invariant, naming it.
 */

import {
  computeWindowAggregate,
  aggregate,
  buildScorecards,
  percentile,
  type SettlementEvent,
  type OutcomeRow,
  type Window,
} from '../lib/reputation/aggregate.js';

const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) return;
  failures.push(detail ? `${name}: ${detail}` : name);
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
//
// Deterministic and committed. `now` is fixed so a test that passes today
// passes in six months.

const NOW = new Date('2026-06-15T12:00:00.000Z');
const NOW_MS = NOW.getTime();
const DAY = 86_400_000;

/** Settlement events for computeWindowAggregate, spread across 90 days. */
function makeEvents(
  count: number,
  { anchorId = 'anchor-1', spanDays = 90, successEvery = 10 } = {}
): SettlementEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    anchorId,
    corridor: 'usdc-ngn',
    completedAt: new Date(NOW_MS - (i % spanDays) * DAY),
    settlementMs: 120_000 + i * 137,
    success: i % successEvery !== 0,
  }));
}

/** Outcome rows for aggregate()/buildScorecards(). */
function makeRows(count: number, { anchorId = 'anchor-1', spanDays = 60 } = {}): OutcomeRow[] {
  return Array.from({ length: count }, (_, i) => ({
    intentHash: `hash-${i}`,
    anchorId,
    filled: i % 7 !== 0,
    settleMs: 90_000 + i * 211,
    slippage: (i % 5) / 1000,
    recordedAt: NOW_MS - (i % spanDays) * DAY,
  }));
}

// ─── Invariant 1: composite scores stay in range ──────────────────────────────

for (const windowDays of [7, 30, 90] as const) {
  const result = computeWindowAggregate(makeEvents(500), 'anchor-1', windowDays, NOW);
  const composite = result.compositeScore;

  check(
    `composite in [0,1] (${windowDays}d)`,
    composite === null || (composite >= 0 && composite <= 1),
    `got ${composite}`
  );
}

// An all-failure set is the edge that most often escapes: a divide-by-zero or a
// negative penalty shows up here before it shows up anywhere else.
{
  const allFailed = makeEvents(50, { successEvery: 1 }).map((e) => ({ ...e, success: false }));
  const result = computeWindowAggregate(allFailed, 'anchor-1', 30, NOW);
  check(
    'composite in [0,1] with zero successes',
    result.compositeScore === null || (result.compositeScore >= 0 && result.compositeScore <= 1),
    `got ${result.compositeScore}`
  );
}

// ─── Invariant 2: window nesting ──────────────────────────────────────────────
//
// A 7-day window cannot contain an event a 30-day window excludes. If this
// breaks, a cutoff comparison has flipped and every score is silently wrong.

{
  const events = makeEvents(400);
  const w7 = computeWindowAggregate(events, 'anchor-1', 7, NOW);
  const w30 = computeWindowAggregate(events, 'anchor-1', 30, NOW);
  const w90 = computeWindowAggregate(events, 'anchor-1', 90, NOW);

  check('7d ⊆ 30d', w7.txCount <= w30.txCount, `${w7.txCount} > ${w30.txCount}`);
  check('30d ⊆ 90d', w30.txCount <= w90.txCount, `${w30.txCount} > ${w90.txCount}`);
}

// ─── Invariant 3: a success never lowers the composite ────────────────────────
//
// The direction of the scoring function. A sign error here would rank the worst
// anchors first, which is worse than not ranking at all.

{
  const base = makeEvents(200);
  const before = computeWindowAggregate(base, 'anchor-1', 30, NOW).compositeScore;

  const withSuccess = [
    ...base,
    {
      anchorId: 'anchor-1',
      corridor: 'usdc-ngn',
      completedAt: new Date(NOW_MS - DAY),
      settlementMs: 60_000,
      success: true,
    },
  ];
  const after = computeWindowAggregate(withSuccess, 'anchor-1', 30, NOW).compositeScore;

  check(
    'adding a success never lowers the composite',
    before === null || after === null || after >= before - 1e-9,
    `${before} → ${after}`
  );
}

// ─── Invariant 4: scorecards are internally consistent ────────────────────────

{
  const rows = makeRows(300);
  const cards = buildScorecards(rows, NOW_MS);

  for (const window of [7, 30, 90] as const) {
    const card = cards[window];
    check(`scorecard exists (${window}d)`, card !== undefined);
    if (!card) continue;

    check(`scorecard window matches key (${window}d)`, card.window === window);
    check(`sampleSize is non-negative (${window}d)`, card.sampleSize >= 0);

    if (card.state === 'ok') {
      check(
        `fillRate in [0,1] (${window}d)`,
        card.fillRate >= 0 && card.fillRate <= 1,
        `got ${card.fillRate}`
      );
      check(
        `settle p50 <= p95 (${window}d)`,
        card.settleMs.p50 <= card.settleMs.p95,
        `${card.settleMs.p50} > ${card.settleMs.p95}`
      );
    }
  }

  check(
    'scorecard sample sizes nest 7 ⊆ 30 ⊆ 90',
    cards[7].sampleSize <= cards[30].sampleSize && cards[30].sampleSize <= cards[90].sampleSize,
    `${cards[7].sampleSize}, ${cards[30].sampleSize}, ${cards[90].sampleSize}`
  );
}

// ─── Invariant 5: empty input degrades, never throws ──────────────────────────

{
  const empty = computeWindowAggregate([], 'anchor-1', 30, NOW);
  check('empty input yields null composite', empty.compositeScore === null);
  check('empty input yields zero txCount', empty.txCount === 0);

  const card = aggregate([], 7, NOW_MS);
  check('empty input yields insufficient_data', card.state === 'insufficient_data');
}

// ─── Invariant 6: percentile is monotone ──────────────────────────────────────

{
  const sorted = [1, 2, 3, 5, 8, 13, 21, 34];
  const values = [0, 25, 50, 75, 95, 100].map((p) => percentile(sorted, p));
  const monotone = values.every((v, i) => i === 0 || v >= (values[i - 1] ?? 0));

  check('percentile is monotone in p', monotone, values.join(', '));
  check('percentile(0) is the minimum', percentile(sorted, 0) === 1);
  check('percentile(100) is the maximum', percentile(sorted, 100) === 34);
}

// ─── Report ───────────────────────────────────────────────────────────────────

const summary = [
  '### Reputation aggregate integrity',
  '',
  failures.length === 0 ? 'All invariants hold.' : `**${failures.length} invariant(s) violated:**`,
  ...failures.map((f) => `- ${f}`),
].join('\n');

console.log(summary);

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.log(`::error::reputation integrity: ${failure}`);
  }
  process.exit(1);
}
