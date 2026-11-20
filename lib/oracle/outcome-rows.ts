import type { OutcomeLogRow, OutcomeStatus } from '@/types/reputation';

/**
 * lib/oracle/outcome-rows.ts
 *
 * The publisher tick reads `outcome_log` with raw SQL through the shared pool,
 * and `pg` returns column names as stored: snake_case. The oracle derivations
 * (`deriveAllCorridorRates`, `deriveCorridorMetrics`) are written against
 * `OutcomeLogRow`, which is camelCase. Handing them raw rows reads every field
 * as `undefined`; for the rate derivation that throws on `undefined.trim()`,
 * which the tick's `catch` then turns into "no rates", silently.
 */

function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Maps one `outcome_log` row, as returned by `pg`, to an {@link OutcomeLogRow}.
 *
 * Only the columns the oracle derivations read need to be selected; the rest
 * take neutral defaults. Numeric columns arrive from `pg` as strings (BIGINT) or
 * numbers, so both are accepted.
 */
export function mapOutcomeRow(r: Record<string, unknown>): OutcomeLogRow {
  return {
    intentHash: String(r['intent_hash'] ?? ''),
    anchorId: String(r['anchor_id'] ?? ''),
    corridor: String(r['corridor'] ?? ''),
    direction: r['direction'] === 'deposit' ? 'deposit' : 'withdraw',
    quotedRate: String(r['quoted_rate'] ?? ''),
    deliveredRate: str(r['delivered_rate']),
    quotedAmount: String(r['quoted_amount'] ?? ''),
    deliveredAmount: str(r['delivered_amount']),
    settleSeconds: num(r['settle_seconds']),
    outcome: String(r['outcome'] ?? '') as OutcomeStatus,
    createdAt: String(r['created_at'] ?? ''),
    stellarTransactionId: str(r['stellar_transaction_id']),
    reconciledAt: str(r['reconciled_at']),
    disputed: Boolean(r['disputed']),
    disputedReason: str(r['disputed_reason']),
    publishedAt: str(r['published_at']),
    oracleTxHash: str(r['oracle_tx_hash']),
    attested: r['attested'] === undefined ? true : Boolean(r['attested']),
    signerAccount: str(r['signer_account']),
  };
}
