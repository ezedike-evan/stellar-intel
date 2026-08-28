/**
 * lib/stellar/blend.ts
 *
 * Thin wrapper around @blend-capital/blend-sdk for reading a Blend lending
 * pool's supply APY and building the unsigned "supply collateral" operation
 * -- Blend is the established Soroban lending protocol on Stellar, per
 * issue #816's own instruction not to rebuild what already exists.
 */

export interface BlendNetworkConfig {
  rpc: string;
  passphrase: string;
}

export class BlendReserveNotFoundError extends Error {
  constructor(
    readonly poolId: string,
    readonly assetId: string
  ) {
    super(`Reserve for asset "${assetId}" not found in Blend pool "${poolId}"`);
    this.name = 'BlendReserveNotFoundError';
  }
}

export interface BlendReserveInfo {
  /** Estimated supply APY -- moves with pool utilization, not a firm rate. */
  estSupplyApy: number;
  /** The reserve asset's decimal precision, needed to convert a human amount to base units. */
  decimals: number;
}

/**
 * Loads a pool's reserve for `assetId` and returns its current estimated
 * supply APY and decimal precision.
 *
 * Dynamic import: @blend-capital/blend-sdk (like @stellar/stellar-sdk) is a
 * dual CJS/ESM package; see lib/stellar/sep1.ts's resolveAnchor for the same
 * workaround and rationale.
 */
export async function getBlendReserveInfo(
  network: BlendNetworkConfig,
  poolId: string,
  assetId: string
): Promise<BlendReserveInfo> {
  const { PoolV2 } = await import('@blend-capital/blend-sdk');
  const pool = await PoolV2.load(network, poolId);
  const reserve = pool.reserves.get(assetId);
  if (!reserve) throw new BlendReserveNotFoundError(poolId, assetId);
  return { estSupplyApy: reserve.estSupplyApy, decimals: reserve.config.decimals };
}

export interface BuildBlendSupplyParams {
  poolId: string;
  assetId: string;
  /** Account supplying the asset; also the spender and beneficiary of the position. */
  account: string;
  /** Amount to supply, in the asset's base units (its full-precision integer, as a bigint). */
  amount: bigint;
}

/**
 * Builds the unsigned "supply collateral" operation for a Blend pool as a
 * base64 XDR string, via PoolContract.submit. This connector never holds a
 * signing key -- signing and submission are the caller's responsibility,
 * matching the existing withdraw-payment flow (buildWithdrawPayment /
 * signAndSubmitPayment in lib/stellar/horizon.ts).
 */
export async function buildBlendSupplyOperation(params: BuildBlendSupplyParams): Promise<string> {
  const { PoolContractV2, RequestType } = await import('@blend-capital/blend-sdk');
  const contract = new PoolContractV2(params.poolId);
  return contract.submit({
    from: params.account,
    spender: params.account,
    to: params.account,
    requests: [
      {
        amount: params.amount,
        request_type: RequestType.SupplyCollateral,
        address: params.assetId,
      },
    ],
  });
}
