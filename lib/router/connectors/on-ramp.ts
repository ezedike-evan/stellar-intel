/**
 * lib/router/connectors/on-ramp.ts
 *
 * On-ramp hop connector (#816), the first of the three connectors implementing
 * the Hop interface from the solver hop architecture (#815). Wraps this app's
 * existing SEP-24 deposit infrastructure (fetchAnchorFee / initiateDeposit) as
 * a Hop: fiat in, an on-chain asset (an anchor's registered asset, USDC by
 * default) out.
 */

import { getResolvedAnchorById } from '@/lib/stellar/anchors';
import { fetchAnchorFee, initiateDeposit } from '@/lib/stellar/sep24';
import { computeTotalReceived } from '@/lib/utils';
import type { Hop, HopAsset, HopExecutionResult, HopPlanResult, HopStep } from '@/types';

export interface OnRampHopParams {
  /** Anchor id from constants/anchors.ts, e.g. 'moneygram'. */
  anchorId: string;
  /** Stellar account credited when the deposit completes. */
  account: string;
  /** SEP-10 JWT for the anchor, obtained beforehand. */
  jwt: string;
  /** SEP-24 /fee `type` parameter. */
  type?: 'bank_account' | 'cash' | 'mobile_money';
}

/**
 * Builds an on-ramp Hop for a single anchor.
 *
 * `plan` estimates the on-chain asset the user will receive for a fiat input
 * using the anchor's published SEP-24 deposit fee schedule -- an estimate,
 * not a firm quote, exactly like the existing sep24-fee rate path.
 *
 * `execute` opens the anchor's interactive deposit session. Deposit
 * completion (KYC, payment, on-chain credit) always happens out of band in
 * the anchor's hosted UI, so `execute` succeeds once that session has been
 * created, not once funds have actually landed -- the same handoff shape as
 * the existing withdraw flow (initiateWithdraw / openWithdrawPopup).
 */
export function createOnRampHop(params: OnRampHopParams): Hop {
  const hopId = `${params.anchorId}-on-ramp`;
  const feeType = params.type ?? 'bank_account';

  return {
    type: 'on-ramp',
    id: hopId,

    async plan(input: HopAsset): Promise<HopPlanResult> {
      let anchor;
      try {
        anchor = await getResolvedAnchorById(params.anchorId);
      } catch (err) {
        return {
          ok: false,
          hopId,
          error: 'anchor_resolution_failed',
          details: err instanceof Error ? err.message : String(err),
        };
      }

      let fee: string;
      let exchangeRate: number;
      try {
        ({ fee, exchangeRate } = await fetchAnchorFee({
          anchorDomain: anchor.homeDomain,
          operation: 'deposit',
          assetCode: anchor.assetCode,
          assetIssuer: anchor.assetIssuer,
          amount: input.amount,
          type: feeType,
        }));
      } catch (err) {
        return {
          ok: false,
          hopId,
          error: 'fee_lookup_failed',
          details: err instanceof Error ? err.message : String(err),
        };
      }

      if (exchangeRate <= 0) {
        return {
          ok: false,
          hopId,
          error: 'no_exchange_rate',
          details: `${anchor.name} returned a zero or missing exchange rate for a ${input.asset} deposit`,
        };
      }

      const received = computeTotalReceived(Number(input.amount), Number(fee), 0, exchangeRate);
      if (!Number.isFinite(received) || received <= 0) {
        return {
          ok: false,
          hopId,
          error: 'amount_too_small',
          details: `Deposit amount ${input.amount} does not clear ${anchor.name}'s fee`,
        };
      }

      const step: HopStep = {
        hopType: 'on-ramp',
        hopId,
        input,
        output: {
          asset: `stellar:${anchor.assetCode}:${anchor.assetIssuer}`,
          amount: received.toFixed(7),
        },
        details: { anchorId: anchor.id, fee, exchangeRate },
      };
      return { ok: true, step };
    },

    async execute(step: HopStep): Promise<HopExecutionResult> {
      let anchor;
      try {
        anchor = await getResolvedAnchorById(params.anchorId);
      } catch (err) {
        return {
          ok: false,
          hopId,
          error: 'anchor_resolution_failed',
          details: err instanceof Error ? err.message : String(err),
        };
      }

      try {
        const deposit = await initiateDeposit(anchor, {
          jwt: params.jwt,
          assetCode: anchor.assetCode,
          assetIssuer: anchor.assetIssuer,
          amount: step.input.amount,
          account: params.account,
        });

        return {
          ok: true,
          hopId,
          // The step's planned output amount is an estimate; the anchor
          // credits the account directly once the interactive session
          // completes, so there is no confirmed on-chain amount to report yet.
          output: step.output,
          txRef: deposit.id,
        };
      } catch (err) {
        return {
          ok: false,
          hopId,
          error: 'deposit_initiation_failed',
          details: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
