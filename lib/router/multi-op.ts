/**
 * lib/router/multi-op.ts
 *
 * Atomic multi-anchor withdrawal transaction (issue #800).
 *
 * A multi-anchor split (see `solveMultiAnchor` in `lib/router/solve.ts`) is
 * executed as ONE Stellar transaction carrying one payment operation per leg.
 * Stellar applies a transaction's operations atomically — every operation
 * succeeds or the whole transaction fails — so the user signs once and either
 * all anchor legs receive their tranche or none do. A partial fill can never
 * strand funds at a single anchor.
 *
 * Non-custodial: this only *builds* the unsigned envelope. Signing stays in the
 * user's wallet (Freighter), exactly like the single-anchor path — see
 * `docs/NON_CUSTODY.md`. The account is constructed with a caller-supplied
 * sequence so the builder is pure and never touches the network.
 *
 * Memo note: a Stellar transaction carries a single memo, so per-anchor memos
 * cannot be attached to individual operations. Anchors that require a unique
 * per-withdrawal memo therefore cannot share one atomic transaction; the
 * splitting strategy is for anchors that correlate by destination + amount, or
 * a future extension can fall back to sequential per-anchor transactions.
 */

import {
  Account,
  Asset,
  BASE_FEE,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

/** One payment leg of the atomic multi-anchor transaction. */
export interface MultiOpLeg {
  /** Anchor's Stellar account that receives this tranche. */
  destination: string;
  /** Tranche amount to pay this anchor, in the sell asset (decimal string). */
  amount: string;
}

export interface BuildMultiAnchorTxParams {
  /** User's Stellar public key (the source of every payment leg). */
  sender: string;
  /** The split legs, one payment operation each. */
  legs: MultiOpLeg[];
  /** Sell-asset code (e.g. USDC). */
  assetCode: string;
  /** Sell-asset issuer. */
  assetIssuer: string;
  /** Source account sequence; defaults to '0' (caller re-sequences before submit). */
  sequence?: string;
  /** Network passphrase; defaults to mainnet. */
  networkPassphrase?: string;
  /** Transaction validity window in seconds. */
  timeoutSeconds?: number;
}

/**
 * Builds the unsigned XDR for an atomic multi-anchor withdrawal: one
 * `payment` operation per leg, all sharing one transaction. The fee scales with
 * the operation count (Stellar charges the base fee per operation).
 *
 * Throws if no legs are supplied — an empty split is never a valid transaction.
 */
export function buildMultiAnchorWithdrawTx(params: BuildMultiAnchorTxParams): string {
  const {
    sender,
    legs,
    assetCode,
    assetIssuer,
    sequence = '0',
    networkPassphrase = Networks.PUBLIC,
    timeoutSeconds = 300,
  } = params;

  if (legs.length === 0) {
    throw new Error('multi-anchor transaction requires at least one leg');
  }

  const asset = new Asset(assetCode, assetIssuer);
  const account = new Account(sender, sequence);

  // `fee` here is the per-operation base fee; the SDK multiplies it by the
  // operation count, so the total transaction fee scales with the leg count.
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  }).setTimeout(timeoutSeconds);

  for (const leg of legs) {
    builder.addOperation(
      Operation.payment({
        destination: leg.destination,
        asset,
        amount: leg.amount,
      })
    );
  }

  return builder.build().toXDR();
}
