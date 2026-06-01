import { useCallback, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { TERMINAL_STATES } from '@/lib/stellar/sep24'
import type { Sep24Transaction, WithdrawStatusValue } from '@/types'

export const WITHDRAW_POLL_INITIAL_MS = 2_000
export const WITHDRAW_POLL_MAX_MS = 30_000
export const WITHDRAW_POLL_MULTIPLIER = 1.5

/** Next poll delay after a successful fetch with unchanged status. O(1) time, O(1) space. */
export function computeNextWithdrawPollIntervalMs(currentMs: number): number {
  return Math.min(Math.round(currentMs * WITHDRAW_POLL_MULTIPLIER), WITHDRAW_POLL_MAX_MS)
}

async function fetchTransaction(
  [transferServer, transactionId, jwt]: [string, string, string],
  signal?: AbortSignal
): Promise<Sep24Transaction> {
  const res = await fetch(`${transferServer}/transaction?id=${transactionId}`, {
    headers: { Authorization: `Bearer ${jwt}` },
    ...(signal !== undefined ? { signal } : {}),
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
    refunds: tx['refunds'] as Sep24Transaction['refunds'],
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
  refunds: Sep24Transaction['refunds'] | undefined
  updatedAt: Date | undefined
  isLoading: boolean
  error: string | undefined
}

/**
 * Polls the anchor SEP-24 /transaction endpoint with exponential backoff
 * (2s -> x1.5 -> cap 30s). Resets to 2s on status change; stops on terminal states.
 */
export function useWithdrawStatus(
  transferServer: string | null,
  transactionId: string | null,
  jwt: string | null
): UseWithdrawStatusResult {
  const pollIntervalMsRef = useRef(WITHDRAW_POLL_INITIAL_MS)
  const lastStatusRef = useRef<WithdrawStatusValue | undefined>(undefined)
  const abortRef = useRef<AbortController | null>(null)

  const key =
    transferServer && transactionId && jwt
      ? ([transferServer, transactionId, jwt] as [string, string, string])
      : null

  useEffect(() => {
    pollIntervalMsRef.current = WITHDRAW_POLL_INITIAL_MS
    lastStatusRef.current = undefined
    abortRef.current = new AbortController()
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [transferServer, transactionId, jwt])

  const fetcher = useCallback(
    (swrKey: [string, string, string]) =>
      fetchTransaction(swrKey, abortRef.current?.signal),
    []
  )

  const { data, error, isLoading } = useSWR<Sep24Transaction, Error>(key, fetcher, {
    refreshInterval(latestData) {
      if (!latestData) return WITHDRAW_POLL_INITIAL_MS
      return TERMINAL_STATES.has(latestData.status) ? 0 : pollIntervalMsRef.current
    },
    onSuccess(data) {
      if (lastStatusRef.current !== data.status) {
        lastStatusRef.current = data.status
        pollIntervalMsRef.current = WITHDRAW_POLL_INITIAL_MS
        return
      }
      pollIntervalMsRef.current = computeNextWithdrawPollIntervalMs(pollIntervalMsRef.current)
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
    refunds: data?.refunds,
    updatedAt: data?.updatedAt,
    isLoading,
    error: error?.message,
  }
}
