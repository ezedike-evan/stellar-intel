import type { OutcomeLogRow } from '@/types/reputation';

const DAY_MS = 86_400_000;

/**
 * One outcome-log row with the same defaults as `outcomeRow()` in
 * tests/leaderboard-api.spec.ts, except the anchor is moneygram on the
 * usdc-ngn corridor and the row is one day old.
 */
export function makeOutcomeRow(
  overrides: Partial<OutcomeLogRow> & Pick<OutcomeLogRow, 'intentHash'>
): OutcomeLogRow {
  return {
    anchorId: 'moneygram',
    corridor: 'usdc-ngn',
    direction: 'withdraw',
    quotedRate: '1500',
    deliveredRate: '1500',
    quotedAmount: '100',
    deliveredAmount: '100',
    settleSeconds: 60,
    outcome: 'completed',
    createdAt: new Date(Date.now() - DAY_MS).toISOString(),
    stellarTransactionId: null,
    reconciledAt: null,
    disputed: false,
    disputedReason: null,
    publishedAt: null,
    oracleTxHash: null,
    attested: true,
    signerAccount: null,
    ...overrides,
  };
}
