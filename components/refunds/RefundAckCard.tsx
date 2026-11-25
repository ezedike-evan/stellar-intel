'use client';

import { useState, type ReactElement } from 'react';
import useSWR from 'swr';
import type { Sep24Refunds } from '@/types';
import type { PublicRefundCase } from '@/lib/refunds/store';
import { buildRefundAck, hashRefundAck } from '@/lib/refunds/ack';
import { signHash } from '@/lib/intent/sign';

export interface RefundAckCardProps {
  intentHash: string;
  anchorId: string;
  account: string;
  refunds: Sep24Refunds | undefined;
  assetLabel: string; // e.g. 'USDC' or the fiat code
}

export function RefundAckCard({
  intentHash,
  anchorId,
  account,
  refunds,
  assetLabel,
}: RefundAckCardProps): ReactElement {
  const [emptyResponses, setEmptyResponses] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetcher = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch refund status');
    return res.json() as Promise<{ intentHash: string; cases: PublicRefundCase[] }>;
  };

  const { data, mutate } = useSWR(`/api/refunds/${intentHash}`, fetcher, {
    refreshInterval: (latestData) => {
      if (latestData && latestData.cases && latestData.cases.length > 0) return 0;
      if (emptyResponses >= 12) return 0;
      return 5000;
    },
    onSuccess: (resData) => {
      if (!resData.cases || resData.cases.length === 0) {
        setEmptyResponses((prev) => prev + 1);
      }
    },
  });

  const cases = data?.cases;
  const activeCase =
    cases && cases.length > 0
      ? (cases.find((c) => c.status !== 'acknowledged') ?? cases[cases.length - 1])
      : null;

  const handleConfirm = async () => {
    if (!refunds || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const ack = buildRefundAck({
        intentHash,
        anchorId,
        account,
        refunds,
      });
      const hash = await hashRefundAck(ack);
      const { signature } = await signHash(hash);
      const res = await fetch('/api/refunds/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ack, signature }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        setErrorMessage(errBody?.message ?? 'Failed to record refund acknowledgement');
        return;
      }
      await mutate();
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      if (e?.code === 'SIGN_REJECTED') {
        setErrorMessage('You declined to sign. Your refund is still tracked.');
      } else if (e?.code === 'FREIGHTER_UNAVAILABLE') {
        setErrorMessage('Freighter is not available.');
      } else {
        setErrorMessage(e?.message ?? 'Sign request failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // State: No case found yet
  if (!activeCase) {
    if (emptyResponses >= 12) {
      return (
        <div className="rounded-xl border border-border-default bg-bg-sunken p-4 text-sm text-status-unknown">
          We have no refund record for this transfer yet. If you paid and were not refunded, use
          “Flag incorrect outcome”.
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-border-default bg-bg-sunken p-4 text-sm text-status-unknown">
        Checking refund status…
      </div>
    );
  }

  // State: Acknowledged
  if (activeCase.status === 'acknowledged') {
    const formattedDate = activeCase.acknowledgedAt
      ? new Date(activeCase.acknowledgedAt).toLocaleDateString()
      : '';
    return (
      <div className="rounded-xl border border-border-default bg-bg-sunken p-4 text-sm space-y-2">
        <p className="font-medium text-primary-text">Refund confirmed on {formattedDate}</p>
        {activeCase.onChainCheck === 'verified' && (
          <p className="text-secondary-text">Verified on the Stellar ledger</p>
        )}
      </div>
    );
  }

  // State: Owed and refunds undefined
  if (activeCase.status === 'owed' && !refunds) {
    return (
      <div className="rounded-xl border border-border-default bg-bg-sunken p-4 text-sm text-primary-text space-y-2">
        <p>
          The anchor owes you a refund of {activeCase.amountPaid} {assetLabel}. We are tracking it.
        </p>
      </div>
    );
  }

  // State: (owed or refunded) and refunds defined
  if ((activeCase.status === 'owed' || activeCase.status === 'refunded') && refunds) {
    return (
      <div className="rounded-xl border border-border-default bg-bg-sunken p-4 text-sm space-y-3">
        <div className="space-y-1 text-primary-text">
          <p className="font-medium">
            Refund: {refunds.amount_refunded} {assetLabel}
          </p>
          {refunds.amount_fee && (
            <p className="text-xs text-secondary-text">
              Fee: {refunds.amount_fee} {assetLabel}
            </p>
          )}
        </div>

        {errorMessage && <p className="text-sm text-red-500">{errorMessage}</p>}

        <button
          type="button"
          onClick={handleConfirm}
          disabled={submitting}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Confirm I received {refunds.amount_refunded} {assetLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border-default bg-bg-sunken p-4 text-sm text-status-unknown">
      Checking refund status…
    </div>
  );
}
