import type { OutcomeLogRow } from '@/types/reputation';

export function makeOutcomeRow(
  overrides: Partial<OutcomeLogRow> & Pick<OutcomeLogRow, 'intentHash'>
): OutcomeLogRow {
  return {
    anchorId: 'moneygram',
    corridor: 'usdc-ngn',
    direction: 'withdraw',
    quotedRate: '1500.0',
    deliveredRate: '1500.0',
    quotedAmount: '100.0',
    deliveredAmount: '100.0',
    settleSeconds: 120,
    outcome: 'completed',
    createdAt: new Date().toISOString(),
    stellarTransactionId: 'a'.repeat(64),
    reconciledAt: new Date().toISOString(),
    disputed: false,
    disputedReason: null,
    publishedAt: null,
    oracleTxHash: null,
    attested: true,
    signerAccount: 'GBBD672BMD5JLN572A2DTK2G2D77RBPDG7O7X7634F7EQP4EV7XJ7K2X',
    ...overrides,
  };
}
