import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { TERMINAL_STATES, getSep24Transaction } from '@/lib/stellar/sep24';
import { realizedRate } from '@/lib/stellar/realized-rate';
import type { Sep24Transaction, WithdrawStatusValue } from '@/types';
import type { OutcomeDirection, OutcomeStatus } from '@/types/reputation';

/**
 * Context the page supplies so a terminal outcome can be logged (#129/#220).
 *
 * `signature` is the sender's Freighter signature over `intentHash` (see
 * `lib/intent/sign.ts`) and `publicKey` the account that produced it. Both
 * are public values — no key material is ever part of this context. Both are
 * required: the append route rejects an unsigned outcome with 401 (#1267), so
 * a caller with no signature must not set a context at all. `direction`
 * separates on-ramp deposits from off-ramp withdrawals (ONR031); omitted, the
 * server defaults it to 'withdraw'.
 */
export interface OutcomeAppendContext {
  intentHash: string;
  anchorId: string;
  corridor: string;
  quotedRate: string;
  quotedAmount: string;
  direction?: OutcomeDirection;
  publicKey: string;
  signature: string;
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
  return getSep24Transaction(transferServer, transactionId, jwt, signal);
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
  /** How to pay the anchor, for a deposit. Undefined for a withdrawal. */
  instructions: Sep24Transaction['instructions'] | undefined;
  /** An https link to the anchor's own page about the transaction. */
  moreInfoUrl: string | undefined;
  /** A human-readable status note from the anchor. */
  message: string | undefined;
  /** Set when the anchor paid a deposit out as a claimable balance. */
  claimableBalanceId: string | undefined;
  updatedAt: Date | undefined;
  isLoading: boolean;
  error: string | undefined;
  /** Number of successful polls so far for the current transactionId. Resets to 0 on a new key. */
  attemptCount: number;
}

/**
 * Polls the anchor SEP-24 /transaction endpoint with exponential backoff
 * (2s -> x1.5 -> cap 30s). Resets to 2s on status change; stops on terminal states.
 */
export function useWithdrawStatus(
  transferServer: string | null,
  transactionId: string | null,
  jwt: string | null,
  outcomeContext?: OutcomeAppendContext,
  _protocol: 'sep24' | 'sep6' = 'sep24'
): UseWithdrawStatusResult {
  const pollIntervalMsRef = useRef(WITHDRAW_POLL_INITIAL_MS);
  // Mirrored into state so SWR is handed a plain number it re-arms on: passing
  // `refreshInterval` as a function stopped the poll dead after the first
  // response (measured: two requests, then silence), which meant a withdrawal
  // could reach `completed` without this page ever showing it.
  const [pollIntervalMs, setPollIntervalMs] = useState(WITHDRAW_POLL_INITIAL_MS);
  const lastStatusRef = useRef<WithdrawStatusValue | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const appendedRef = useRef(false);
  const startMsRef = useRef(Date.now());
  const [attemptCount, setAttemptCount] = useState(0);

  const key =
    transferServer && transactionId && jwt
      ? ([transferServer, transactionId, jwt] as [string, string, string])
      : null;

  const applyPollInterval = useCallback((ms: number) => {
    pollIntervalMsRef.current = ms;
    setPollIntervalMs(ms);
  }, []);

  useEffect(() => {
    pollIntervalMsRef.current = WITHDRAW_POLL_INITIAL_MS;
    setPollIntervalMs(WITHDRAW_POLL_INITIAL_MS);
    lastStatusRef.current = undefined;
    abortRef.current = new AbortController();
    appendedRef.current = false;
    startMsRef.current = Date.now();
    setAttemptCount(0);
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
    refreshInterval: pollIntervalMs,
    onSuccess(data) {
      setAttemptCount((c) => c + 1);
      // 0 stops the poll, which is what a terminal state should do.
      if (TERMINAL_STATES.has(data.status)) {
        applyPollInterval(0);
        return;
      }
      if (lastStatusRef.current !== data.status) {
        lastStatusRef.current = data.status;
        applyPollInterval(WITHDRAW_POLL_INITIAL_MS);
        return;
      }
      applyPollInterval(computeNextWithdrawPollIntervalMs(pollIntervalMsRef.current));
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
    // The landed rate, on the same all-in basis as the quote: only a completed
    // transaction has one, and only when the anchor reported both amounts.
    const delivered =
      status === 'completed'
        ? realizedRate({
            amountIn: data?.amountIn,
            amountOut: data?.amountOut,
            amountFee: data?.amountFee,
          })
        : null;
    void fetch('/api/reputation/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...outcomeContext,
        outcome: outcomeFromStatus(status),
        deliveredAmount: data?.amountOut ?? null,
        ...(delivered ? { deliveredRate: delivered.allInRate } : {}),
        settleSeconds,
        stellarTransactionId: data?.stellarTransactionId ?? null,
      }),
      keepalive: true,
    }).catch(() => {
      // Best-effort: a failed append must not disrupt the user's status view.
    });
  }, [
    status,
    outcomeContext,
    data?.amountIn,
    data?.amountOut,
    data?.amountFee,
    data?.stellarTransactionId,
  ]);

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
    instructions: data?.instructions,
    moreInfoUrl: data?.moreInfoUrl,
    message: data?.message,
    claimableBalanceId: data?.claimableBalanceId,
    updatedAt: data?.updatedAt,
    isLoading,
    error: error?.message,
    attemptCount,
  };
}

/**
 * The same hook under a direction-neutral name. Nothing in it is specific to
 * withdrawals apart from its name and the fields it returns, and a deposit tracker
 * needs the same polling and backoff: aliasing it keeps one backoff implementation
 * instead of two that drift apart. The original export is unchanged.
 */
export const useTransferStatus = useWithdrawStatus;
export type UseTransferStatusResult = UseWithdrawStatusResult;
