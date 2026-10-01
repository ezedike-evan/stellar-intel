'use client';
import useSWR from 'swr';
import { fetchAccount } from '@/lib/stellar/horizon';
import { USDC_ASSET } from '@/constants/anchors';

export interface UseWalletBalanceResult {
  /** Wallet balance of the requested asset as a number, or null if the account has no trustline for it. */
  balance: number | null;
  isLoading: boolean;
  error: string | undefined;
  refresh: () => void;
}

/** Source asset to read the wallet balance for. Defaults to USDC. */
export interface WalletAsset {
  code: string;
  issuer?: string | null;
}

async function fetchAssetBalance(publicKey: string, asset: WalletAsset): Promise<number | null> {
  const account = await fetchAccount(publicKey);
  if (asset.code === 'XLM' && !asset.issuer) {
    const line = account.balances.find((b) => !('asset_code' in b));
    return line ? Number.parseFloat(line.balance) : null;
  }
  const line = account.balances.find(
    (b) => 'asset_code' in b && b.asset_code === asset.code && b.asset_issuer === asset.issuer
  );
  return line ? Number.parseFloat(line.balance) : null;
}

/** Fetches the connected wallet's balance for the given asset from Horizon. */
export function useWalletBalance(
  publicKey: string | null,
  asset: WalletAsset = USDC_ASSET
): UseWalletBalanceResult {
  const { data, error, isLoading, mutate } = useSWR<number | null, Error>(
    publicKey ? ['wallet-balance', publicKey, asset.code, asset.issuer ?? ''] : null,
    ([, pk]: [string, string]) => fetchAssetBalance(pk, asset),
    { revalidateOnFocus: false }
  );

  return {
    balance: data ?? null,
    isLoading,
    error: error?.message,
    refresh: () => void mutate(),
  };
}
