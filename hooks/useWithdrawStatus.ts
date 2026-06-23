import { useCallback, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { TERMINAL_STATES } from '@/lib/stellar/sep24';
import type { Sep24Transaction, WithdrawStatusValue } from '@/types';
import type { OutcomeStatus } from '@/types/reputation';

/** Context the page supplies so a terminal outcome can be logged (#129/#220). */
export interface OutcomeAppendContext {
  intentHash: string;
  anchorId: string;
  corridor: string;
  quotedRate: string;
  quotedAmount: string;
}

function outcomeFromStatus(status: WithdrawStatusValue): OutcomeStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'refunded':
      return 'refunded';
    case 'expired':
      return 'expired';
    default:
      return 'error';
  }
}

export const WITHDRAW_POLL_INITIAL_MS = 2_000;
export const WITHDRAW_POLL_MAX_MS = 30_000;
export const WITHDRAW_POLL_MULTIPLIER = 1.5;

/** Next poll delay after a successful fetch with unchanged status. O(1) time, O(1) space. */
export function computeNextWithdrawPollIntervalMs(currentMs: number): number {
  return Math.min(Math.round(currentMs * WITHDRAW_POLL_MULTIPLIER), WITHDRAW_POLL_MAX_MS);
}

async function fetchTransaction(
  [transferServer, transactionId, jwt]: [string, string, string],
  signal?: AbortSignal
): Promise<Sep24Transaction> {
  const res = await fetch(`${transferServer}/transaction?id=${transactionId}`, {
    headers: { Authorization: `Bearer ${jwt}` },
    ...(signal !== undefined ? { signal } : {}),
  });

  if (!res.ok) {
    throw new Error(`Status poll failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as { transaction?: Record<string, unknown> };
  const tx = data.transaction ?? {};

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
  };
}

export interface UseWithdrawStatusResult {
  status: WithdrawStatusValue | undefined;
  amountIn: string | undefined;
  amountInAsset: string | undefined;
  amountOut: string | undefined;
  amountOutAsset: string | undefined;
  amountFee: string | undefined;
  stellarTransactionId: string | undefined;
  externalTransactionId: string | undefined;
  refunds: Sep24Transaction['refunds'] | undefined;
  updatedAt: Date | undefined;
  isLoading: boolean;
  error: string | undefined;
}

/**
 * Polls the anchor SEP-24 /transaction endpoint with exponential backoff
 * (2s -> x1.5 -> cap 30s). Resets to 2s on status change; stops on terminal states.
 */
export function useWithdrawStatus(
  transferServer: string | null,
  transactionId: string | null,
  jwt: string | null,
  outcomeContext?: OutcomeAppendContext
): UseWithdrawStatusResult {
  const pollIntervalMsRef = useRef(WITHDRAW_POLL_INITIAL_MS);
  const lastStatusRef = useRef<WithdrawStatusValue | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const appendedRef = useRef(false);
  const startMsRef = useRef(Date.now());

  const key =
    transferServer && transactionId && jwt
      ? ([transferServer, transactionId, jwt] as [string, string, string])
      : null;

  useEffect(() => {
    pollIntervalMsRef.current = WITHDRAW_POLL_INITIAL_MS;
    lastStatusRef.current = undefined;
    abortRef.current = new AbortController();
    appendedRef.current = false;
    startMsRef.current = Date.now();
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [transferServer, transactionId, jwt]);

  const fetcher = useCallback(
    (swrKey: [string, string, string]) => fetchTransaction(swrKey, abortRef.current?.signal),
    []
  );

  const { data, error, isLoading } = useSWR<Sep24Transaction, Error>(key, fetcher, {
    refreshInterval(latestData) {
      if (!latestData) return WITHDRAW_POLL_INITIAL_MS;
      return TERMINAL_STATES.has(latestData.status) ? 0 : pollIntervalMsRef.current;
    },
    onSuccess(data) {
      if (lastStatusRef.current !== data.status) {
        lastStatusRef.current = data.status;
        pollIntervalMsRef.current = WITHDRAW_POLL_INITIAL_MS;
        return;
      }
      pollIntervalMsRef.current = computeNextWithdrawPollIntervalMs(pollIntervalMsRef.current);
    },
    revalidateOnFocus: false,
  });

  // ─── Append-on-terminal (#129 / #220) ────────────────────────────────────────
  // When the poll first reaches a terminal state, POST exactly one outcome row
  // to the server-side write path. The ref guard ensures one row per intent even
  // across re-renders and repeated terminal polls.
  const status = data?.status;
  useEffect(() => {
    if (!status || !outcomeContext || appendedRef.current) return;
    if (!TERMINAL_STATES.has(status)) return;
    appendedRef.current = true;

    const settleSeconds = Math.max(0, Math.round((Date.now() - startMsRef.current) / 1000));
    void fetch('/api/reputation/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...outcomeContext,
        outcome: outcomeFromStatus(status),
        deliveredAmount: data?.amountOut ?? null,
        settleSeconds,
        stellarTransactionId: data?.stellarTransactionId ?? null,
      }),
      keepalive: true,
    }).catch(() => {
      // Best-effort: a failed append must not disrupt the user's status view.
    });
  }, [status, outcomeContext, data?.amountOut, data?.stellarTransactionId]);

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
  };
}
