import useSWR from 'swr'
import type { Sep24Transaction, WithdrawStatusValue } from '@/types'

const TERMINAL_STATES: WithdrawStatusValue[] = ['completed', 'error', 'refunded', 'no_market', 'too_small', 'too_large']

async function fetcher([transferServer, transactionId, jwt]: [string, string, string]): Promise<Sep24Transaction> {
  const res = await fetch(`${transferServer}/transaction?id=${transactionId}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  })

  if (!res.ok) {
    throw new Error(`Status poll failed: HTTP ${res.status}`)
  }

  const data = (await res.json()) as { transaction?: Record<string, unknown> }
  const tx = data.transaction ?? {}

  return {
    id: String(tx['id'] ?? transactionId),
    status: (tx['status'] as WithdrawStatusValue) ?? 'incomplete',
    amountIn: tx['amount_in'] as string | undefined,
    amountInAsset: tx['amount_in_asset'] as string | undefined,
    amountOut: tx['amount_out'] as string | undefined,
    amountOutAsset: tx['amount_out_asset'] as string | undefined,
    amountFee: tx['amount_fee'] as string | undefined,
    updatedAt: new Date(),
    stellarTransactionId: tx['stellar_transaction_id'] as string | undefined,
    externalTransactionId: tx['external_transaction_id'] as string | undefined,
  }
}

export interface UseWithdrawStatusResult {
  status: WithdrawStatusValue | undefined
  amountIn: string | undefined
  amountInAsset: string | undefined
  amountOut: string | undefined
  amountOutAsset: string | undefined
  amountFee: string | undefined
  stellarTransactionId: string | undefined
  externalTransactionId: string | undefined
  updatedAt: Date | undefined
  isLoading: boolean
  error: string | undefined
}

/**
 * Polls the anchor's SEP-24 transaction endpoint every 5 seconds.
 * Polling stops automatically when the transaction reaches a terminal state.
 * Fetching is disabled when any parameter is null.
 */
export function useWithdrawStatus(
  transferServer: string | null,
  transactionId: string | null,
  jwt: string | null
): UseWithdrawStatusResult {
  const key =
    transferServer && transactionId && jwt
      ? ([transferServer, transactionId, jwt] as [string, string, string])
      : null

  const { data, error, isLoading } = useSWR<Sep24Transaction, Error>(key, fetcher, {
    refreshInterval: (latestData: Sep24Transaction | undefined) => {
      if (!latestData) return 5_000
      return TERMINAL_STATES.includes(latestData.status) ? 0 : 5_000
    },
    revalidateOnFocus: false,
  })

  return {
    status: data?.status,
    amountIn: data?.amountIn,
    amountInAsset: data?.amountInAsset,
    amountOut: data?.amountOut,
    amountOutAsset: data?.amountOutAsset,
    amountFee: data?.amountFee,
    stellarTransactionId: data?.stellarTransactionId,
    externalTransactionId: data?.externalTransactionId,
    updatedAt: data?.updatedAt,
    isLoading,
    error: error?.message,
  }
}
