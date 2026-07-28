/**
 * lib/router/connectors/yield-blend.ts
 *
 * Yield hop connector (#816): integrates Blend, the established Soroban
 * lending protocol on Stellar, as a Hop -- per issue #816's own instruction
 * not to rebuild what already exists.
 */

import {
  buildBlendSupplyOperation,
  BlendReserveNotFoundError,
  getBlendReserveInfo,
  type BlendNetworkConfig,
} from '@/lib/stellar/blend';
import type { Hop, HopAsset, HopExecutionResult, HopPlanResult, HopStep } from '@/types';

export interface BlendYieldHopParams {
  /** Soroban contract address (C...) of the Blend pool to supply into. */
  poolId: string;
  network: BlendNetworkConfig;
  /** Stellar account supplying the asset and receiving the position. */
  account: string;
}

/** Converts a human decimal amount string to the asset's base-unit bigint. */
function decimalToBaseUnits(amount: string, decimals: number): bigint {
  const [intPart = '0', fracPartRaw = ''] = amount.split('.');
  const fracPart = (fracPartRaw + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(intPart) * 10n ** BigInt(decimals) + (fracPart ? BigInt(fracPart) : 0n);
}

/**
 * Builds a yield Hop backed by a single Blend pool.
 *
 * `plan` loads the pool's reserve for the input asset and reports its
 * current estimated supply APY -- an estimate that moves with pool
 * utilization, not a firm rate, same caveat as every other indicative
 * figure in this app (see AnchorRate.source / isIndicativeRateSource).
 * Supplying to a lending pool doesn't convert the asset -- interest accrues
 * to the position over time rather than being paid out at deposit time --
 * so the planned output is the same asset and amount as the input.
 *
 * `execute` builds the unsigned "supply collateral" operation via
 * PoolContract.submit and returns it in `details.unsignedXdr` for the
 * caller's wallet to sign and submit -- this connector never holds a
 * signing key, matching the existing withdraw-payment flow
 * (buildWithdrawPayment / signAndSubmitPayment).
 */
export function createBlendYieldHop(params: BlendYieldHopParams): Hop {
  const hopId = `blend-yield-${params.poolId}`;

  return {
    type: 'yield',
    id: hopId,

    async plan(input: HopAsset): Promise<HopPlanResult> {
      if (!input.asset.startsWith('C')) {
        return {
          ok: false,
          hopId,
          error: 'unsupported_asset',
          details: `Blend yield hop requires a Soroban contract address (starts with "C"), got "${input.asset}"`,
        };
      }

      let reserveInfo;
      try {
        reserveInfo = await getBlendReserveInfo(params.network, params.poolId, input.asset);
      } catch (err) {
        if (err instanceof BlendReserveNotFoundError) {
          return { ok: false, hopId, error: 'reserve_not_found', details: err.message };
        }
        return {
          ok: false,
          hopId,
          error: 'pool_load_failed',
          details: err instanceof Error ? err.message : String(err),
        };
      }

      const step: HopStep = {
        hopType: 'yield',
        hopId,
        input,
        output: { asset: input.asset, amount: input.amount },
        details: {
          poolId: params.poolId,
          estSupplyApy: reserveInfo.estSupplyApy,
          decimals: reserveInfo.decimals,
        },
      };
      return { ok: true, step };
    },

    async execute(step: HopStep): Promise<HopExecutionResult> {
      const decimals = step.details['decimals'];
      if (typeof decimals !== 'number') {
        return {
          ok: false,
          hopId,
          error: 'missing_planned_decimals',
          details: 'This step was not planned by this connector (no decimals in step.details)',
        };
      }

      try {
        const amount = decimalToBaseUnits(step.input.amount, decimals);
        const unsignedXdr = await buildBlendSupplyOperation({
          poolId: params.poolId,
          assetId: step.input.asset,
          account: params.account,
          amount,
        });

        return {
          ok: true,
          hopId,
          output: step.output,
          details: { unsignedXdr },
        };
      } catch (err) {
        return {
          ok: false,
          hopId,
          error: 'build_failed',
          details: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
