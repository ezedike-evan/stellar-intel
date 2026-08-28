'use client';
import useSWR from 'swr';
import { fetchAccount } from '@/lib/stellar/horizon';
import { USDC_ASSET } from '@/constants/anchors';

export interface UseWalletBalanceResult {
  /** USDC balance as a number, or null if the account has no USDC trustline. */
  balance: number | null;
  isLoading: boolean;
  error: string | undefined;
  refresh: () => void;
}

async function fetchUsdcBalance(publicKey: string): Promise<number | null> {
  const account = await fetchAccount(publicKey);
  const line = account.balances.find(
    (b) =>
      'asset_code' in b && b.asset_code === USDC_ASSET.code && b.asset_issuer === USDC_ASSET.issuer
  );
  return line ? Number.parseFloat(line.balance) : null;
}

/** Fetches the connected wallet's USDC balance from Horizon. */
export function useWalletBalance(publicKey: string | null): UseWalletBalanceResult {
  const { data, error, isLoading, mutate } = useSWR<number | null, Error>(
    publicKey ? ['usdc-balance', publicKey] : null,
    ([, pk]: [string, string]) => fetchUsdcBalance(pk),
    { revalidateOnFocus: false }
  );

  return {
    balance: data ?? null,
    isLoading,
    error: error?.message,
    refresh: () => void mutate(),
  };
}
