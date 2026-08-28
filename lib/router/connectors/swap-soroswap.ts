/**
 * lib/router/connectors/swap-soroswap.ts
 *
 * Swap hop connector (#816): integrates Soroswap's aggregator
 * (lib/stellar/soroswap.ts) as a Hop, rather than rebuilding a swap
 * aggregator (ROADMAP.md line 90).
 */

import {
  buildSoroswapTransaction,
  getSoroswapQuote,
  SoroswapApiError,
  SoroswapConfigError,
  type SoroswapNetwork,
} from '@/lib/stellar/soroswap';
import type { Hop, HopAsset, HopExecutionResult, HopPlanResult, HopStep } from '@/types';

export interface SoroswapHopParams {
  /** Soroban contract address (C...) this hop swaps into. */
  assetOutContract: string;
  /** Stellar account that will sign and submit the built swap transaction. */
  account: string;
  network?: SoroswapNetwork;
  protocols?: string[];
  slippageBps?: number;
}

function stellarAssetToContractId(asset: string): string {
  // Soroswap's API takes Soroban contract addresses (C...), not the
  // `stellar:CODE:ISSUER` identifiers used elsewhere in this app's SEP
  // plumbing. A hop chain's input asset is expected to already be a
  // resolved contract id by the time it reaches this connector; anything
  // else is a caller error, not a plannable swap failure.
  if (!asset.startsWith('C')) {
    throw new Error(
      `Soroswap swap hop requires a Soroban contract address (starts with "C"), got "${asset}". ` +
        'Resolve the SEP asset to its SAC contract id before chaining into this hop.'
    );
  }
  return asset;
}

/**
 * Builds a swap Hop backed by Soroswap's aggregator.
 *
 * `plan` calls POST /quote and reports the quoted `amountOut` -- an
 * estimate that can move before execution, same as every other indicative
 * rate in this app (see AnchorRate.source / isIndicativeRateSource).
 *
 * `execute` calls POST /quote/build to get an unsigned transaction XDR and
 * returns it in `details.unsignedXdr` for the caller's wallet to sign and
 * submit -- this connector never holds a signing key, matching the existing
 * withdraw-payment flow (buildWithdrawPayment / signAndSubmitPayment).
 */
export function createSoroswapHop(params: SoroswapHopParams): Hop {
  const hopId = 'soroswap-swap';
  const network = params.network ?? 'mainnet';
  const assetOut = params.assetOutContract;

  return {
    type: 'swap',
    id: hopId,

    async plan(input: HopAsset): Promise<HopPlanResult> {
      let assetIn: string;
      try {
        assetIn = stellarAssetToContractId(input.asset);
      } catch (err) {
        return {
          ok: false,
          hopId,
          error: 'unsupported_asset',
          details: err instanceof Error ? err.message : String(err),
        };
      }

      try {
        const quote = await getSoroswapQuote(
          {
            assetIn,
            assetOut,
            amount: input.amount,
            ...(params.protocols !== undefined && { protocols: params.protocols }),
            ...(params.slippageBps !== undefined && { slippageBps: params.slippageBps }),
          },
          network
        );

        const amountOut = Number(quote.amountOut);
        if (!Number.isFinite(amountOut) || amountOut <= 0) {
          return {
            ok: false,
            hopId,
            error: 'invalid_quote',
            details: `Soroswap returned a non-positive amountOut: "${quote.amountOut}"`,
          };
        }

        const step: HopStep = {
          hopType: 'swap',
          hopId,
          input,
          output: { asset: assetOut, amount: quote.amountOut },
          details: { quote },
        };
        return { ok: true, step };
      } catch (err) {
        if (err instanceof SoroswapConfigError) {
          return { ok: false, hopId, error: 'config_error', details: err.message };
        }
        if (err instanceof SoroswapApiError) {
          return {
            ok: false,
            hopId,
            error: 'no_route',
            details: `Soroswap quote failed with HTTP ${err.status}`,
          };
        }
        return {
          ok: false,
          hopId,
          error: 'quote_failed',
          details: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async execute(step: HopStep): Promise<HopExecutionResult> {
      const quote = step.details['quote'];
      if (!quote || typeof quote !== 'object') {
        return {
          ok: false,
          hopId,
          error: 'missing_planned_quote',
          details: 'This step was not planned by this connector (no quote in step.details)',
        };
      }

      try {
        const built = await buildSoroswapTransaction(
          quote as Parameters<typeof buildSoroswapTransaction>[0],
          params.account,
          params.account,
          network
        );

        return {
          ok: true,
          hopId,
          output: step.output,
          details: { unsignedXdr: built.xdr },
        };
      } catch (err) {
        if (err instanceof SoroswapApiError) {
          return {
            ok: false,
            hopId,
            error: 'build_failed',
            details: `Soroswap build failed with HTTP ${err.status}`,
          };
        }
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
