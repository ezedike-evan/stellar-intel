import { describe, it, expect } from 'vitest';
import {
  SLIPPAGE_COMPLIANCE_MIN_INTENTS,
  SLIPPAGE_COMPLIANCE_TARGET_PCT,
  computeSlippageCompliance,
  type SlippageComplianceWindow,
} from '@/lib/reputation/slippage-compliance';
import type { OutcomeLogRow, SlippageBreach } from '@/types/reputation';

const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (d: number) => new Date(NOW - d * DAY_MS).toISOString();

type BreachRef = Pick<SlippageBreach, 'intentHash' | 'status'>;

let n = 0;
/** An eligible row: an attested, completed, undisputed withdrawal with a floor and a delivered amount. */
function row(over: Partial<OutcomeLogRow> = {}): OutcomeLogRow {
  n += 1;
  return {
    intentHash: String(n).padStart(64, '0'),
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    direction: 'withdraw',
    quotedRate: '1500',
    deliveredRate: '1500',
    quotedAmount: '100',
    deliveredAmount: '1450',
    settleSeconds: 60,
    outcome: 'completed',
    createdAt: daysAgo(1),
    stellarTransactionId: null,
    reconciledAt: null,
    disputed: false,
    disputedReason: null,
    publishedAt: null,
    oracleTxHash: null,
    attested: true,
    signerAccount: null,
    minReceive: '1400',
    ...over,
  };
}

const rows = (count: number, over: Partial<OutcomeLogRow> = {}) =>
  Array.from({ length: count }, () => row(over));

/** One breach record for each of the first `count` rows. */
const breachesOf = (
  from: readonly OutcomeLogRow[],
  count: number,
  status: SlippageBreach['status'] = 'detected'
): BreachRef[] => from.slice(0, count).map((r) => ({ intentHash: r.intentHash, status }));

const compliance = (
  log: readonly OutcomeLogRow[],
  breaches: readonly BreachRef[] = [],
  window: SlippageComplianceWindow = 30
) => computeSlippageCompliance(log, breaches, { window, now: NOW });

describe('computeSlippageCompliance (#2107, SLP011)', () => {
  it('pins the v3 gate at 99.5% over 10,000 intents', () => {
    expect(SLIPPAGE_COMPLIANCE_TARGET_PCT).toBe(99.5);
    expect(SLIPPAGE_COMPLIANCE_MIN_INTENTS).toBe(10_000);
  });

  it('has no percentage and does not meet the gate when nothing is eligible', () => {
    expect(compliance([])).toEqual({
      window: 30,
      eligibleIntents: 0,
      breaches: 0,
      verifiedBreaches: 0,
      compliancePct: null,
      gate: { targetPct: 99.5, minIntents: 10_000, met: false },
    });
    // A breach with no eligible intent behind it changes nothing.
    expect(compliance([], [{ intentHash: 'a'.repeat(64), status: 'verified' }])).toMatchObject({
      breaches: 0,
      verifiedBreaches: 0,
      compliancePct: null,
    });
  });

  it('reaches 99.5 with 5 breaches in 1000 intents, but not the gate: too few intents', () => {
    const log = rows(1000);
    const result = compliance(log, breachesOf(log, 5));

    expect(result.eligibleIntents).toBe(1000);
    expect(result.breaches).toBe(5);
    expect(result.compliancePct).toBe(99.5);
    expect(result.gate.met).toBe(false);
  });

  it('meets the gate with 50 breaches in 10,000 intents', () => {
    const log = rows(10_000);
    const result = compliance(log, breachesOf(log, 50));

    expect(result).toEqual({
      window: 30,
      eligibleIntents: 10_000,
      breaches: 50,
      verifiedBreaches: 0,
      compliancePct: 99.5,
      gate: { targetPct: 99.5, minIntents: 10_000, met: true },
    });
  });

  it('misses the gate with one breach more: 51 in 10,000 is 99.49', () => {
    const log = rows(10_000);
    const result = compliance(log, breachesOf(log, 51));

    expect(result.compliancePct).toBe(99.49);
    expect(result.gate.met).toBe(false);
  });

  it('misses the gate one intent short of 10,000, even with no breach at all', () => {
    const result = compliance(rows(9_999));

    expect(result.compliancePct).toBe(100);
    expect(result.gate.met).toBe(false);
  });

  it('ignores rejected breaches, counts detected and verified ones, and reports the verified apart', () => {
    const log = rows(1000);
    const result = compliance(log, [
      ...breachesOf(log, 2, 'verified'),
      ...breachesOf(log.slice(2), 3, 'detected'),
      ...breachesOf(log.slice(5), 4, 'rejected'),
    ]);

    expect(result.breaches).toBe(5);
    expect(result.verifiedBreaches).toBe(2);
    expect(result.compliancePct).toBe(99.5);
  });

  it.each([
    ['a deposit', { direction: 'deposit' }],
    ['an unattested row', { attested: false }],
    ['a disputed row', { disputed: true }],
    ['a row that did not complete', { outcome: 'refunded' }],
    ['a partial row', { outcome: 'partial' }],
    ['a row with no floor', { minReceive: null }],
    ['a row whose floor is absent', { minReceive: undefined }],
    ['a row with no delivered amount', { deliveredAmount: null }],
    ['a row outside the window', { createdAt: daysAgo(31) }],
    ['a row whose date cannot be read', { createdAt: 'not a date' }],
  ] as const)('leaves out %s, and a breach recorded for it', (_name, over) => {
    const counted = rows(4);
    const left = row(over as Partial<OutcomeLogRow>);
    const result = compliance(
      [...counted, left],
      [{ intentHash: left.intentHash, status: 'verified' }]
    );

    expect(result.eligibleIntents).toBe(4);
    expect(result.breaches).toBe(0);
    expect(result.verifiedBreaches).toBe(0);
    expect(result.compliancePct).toBe(100);
  });

  it('ignores a breach whose intent is not in the log at all', () => {
    const result = compliance(rows(4), [{ intentHash: 'f'.repeat(64), status: 'detected' }]);

    expect(result.breaches).toBe(0);
    expect(result.compliancePct).toBe(100);
  });

  it('counts an intent once however many breach records name it', () => {
    const log = rows(4);
    const twice: BreachRef[] = [
      { intentHash: log[0]!.intentHash, status: 'detected' },
      { intentHash: log[0]!.intentHash, status: 'verified' },
    ];
    const result = compliance(log, twice);

    expect(result.breaches).toBe(1);
    expect(result.verifiedBreaches).toBe(1);
    expect(result.compliancePct).toBe(75);
  });

  it('cuts the window at exactly 30 and 90 days, and not at all for "all"', () => {
    const atThirty = row({ createdAt: daysAgo(30) });
    const pastThirty = row({ createdAt: new Date(NOW - 30 * DAY_MS - 1).toISOString() });
    const atNinety = row({ createdAt: daysAgo(90) });
    const pastNinety = row({ createdAt: new Date(NOW - 90 * DAY_MS - 1).toISOString() });
    const old = row({ createdAt: daysAgo(4000) });
    const log = [atThirty, pastThirty, atNinety, pastNinety, old];

    expect(compliance(log, [], 30).eligibleIntents).toBe(1);
    expect(compliance(log, [], 90).eligibleIntents).toBe(3);
    expect(compliance(log, [], 'all').eligibleIntents).toBe(5);
    expect(compliance(log, [], 'all').window).toBe('all');
    // A date that cannot be read is in no window, not even this one.
    expect(compliance([...log, row({ createdAt: '' })], [], 'all').eligibleIntents).toBe(5);
  });

  it('judges a breach by the window too: one on an intent outside it does not count', () => {
    const recent = rows(3);
    const old = row({ createdAt: daysAgo(60) });
    const breach: BreachRef[] = [{ intentHash: old.intentHash, status: 'verified' }];

    expect(compliance([...recent, old], breach, 30)).toMatchObject({
      eligibleIntents: 3,
      breaches: 0,
      compliancePct: 100,
    });
    expect(compliance([...recent, old], breach, 90)).toMatchObject({
      eligibleIntents: 4,
      breaches: 1,
      verifiedBreaches: 1,
      compliancePct: 75,
    });
  });

  it('rounds to two decimals', () => {
    const log = rows(3);

    // 2 of 3 is 66.666…
    expect(compliance(log, breachesOf(log, 1)).compliancePct).toBe(66.67);
    // 1 of 3 is 33.333…
    expect(compliance(log, breachesOf(log, 2)).compliancePct).toBe(33.33);
    expect(compliance(log, breachesOf(log, 3)).compliancePct).toBe(0);
  });

  it('uses the current time when none is given', () => {
    const fresh = row({ createdAt: new Date().toISOString() });
    const result = computeSlippageCompliance([fresh], [], { window: 30 });

    expect(result.eligibleIntents).toBe(1);
  });
});
