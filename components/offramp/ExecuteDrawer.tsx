'use client';
import { getAnchorById } from '@/lib/stellar/anchors';
import { buildWithdrawPayment, signAndSubmitPayment } from '@/lib/stellar/horizon';
import { getTransferServer } from '@/lib/stellar/sep1';
import { authenticate } from '@/lib/stellar/sep10';
import { getWithdrawTransactionRecord, initiateWithdraw } from '@/lib/stellar/sep24';
import type { AnchorRate } from '@/types';
import { useEffect, useState } from 'react';
import { KycIframe } from './KycIframe';

// ─── Step definitions ─────────────────────────────────────────────────────────

type Step =
  | 'idle'
  | 'authenticating'
  | 'initiating'
  | 'kyc'
  | 'building'
  | 'signing'
  | 'done'
  | 'error';

const STEP_LABELS: Record<Step, string> = {
  idle: 'Ready',
  authenticating: 'Authenticating with anchor…',
  initiating: 'Initiating withdrawal…',
  kyc: 'Complete KYC in popup…',
  building: 'Building payment transaction…',
  signing: 'Sign transaction in Freighter…',
  done: 'Transaction submitted',
  error: 'Something went wrong',
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface ExecuteDrawerProps {
  rate: AnchorRate | null;
  amount: string;
  publicKey: string;
  onClose: () => void;
  /** Called once the Stellar payment is submitted; closes the drawer and hands tracking data to the page. */
  onExecuteStarted: (transactionId: string, transferServer: string, jwt: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ExecuteDrawer({
  rate,
  amount,
  publicKey,
  onClose,
  onExecuteStarted,
}: ExecuteDrawerProps) {
  const [step, setStep] = useState<Step>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [kycUrl, setKycUrl] = useState<string | null>(null);
  const [kycOrigin, setKycOrigin] = useState<string | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const isOpen = rate !== null;

  // Handle escape key for closing drawer
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen && !['idle', 'done', 'error'].includes(step)) {
        setShowConfirmDialog(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, step]);

  async function handleExecute() {
    if (!rate) return;

    setStep('authenticating');
    setErrorMsg(null);
    setTxHash(null);

    try {
      // Step 1 — SEP-10 auth
      const anchor = getAnchorById(rate.anchorId);
      const auth = await authenticate(anchor.homeDomain, publicKey);

      // Step 2 — Initiate SEP-24 withdraw
      setStep('initiating');
      const transferServer = await getTransferServer(anchor.homeDomain);
      if (!transferServer) {
        throw new Error(`Anchor "${anchor.homeDomain}" does not support SEP-24.`);
      }

      const withdrawResp = await initiateWithdraw({
        transferServer,
        assetCode: anchor.assetCode,
        assetIssuer: anchor.assetIssuer,
        amount,
        account: publicKey,
        jwt: auth.jwt,
      });

      // Step 3 — KYC iframe
      setStep('kyc');
      const url = new URL(withdrawResp.url);
      setKycUrl(withdrawResp.url);
      setKycOrigin(url.origin);

      // Wait for KYC completion via iframe postMessage
      const transactionId = await new Promise<string>((resolve, reject) => {
        // This will be resolved by the KycIframe component
        window.currentKycResolve = resolve;
        window.currentKycReject = reject;
      });

      // Step 4 — Fetch transaction record
      setStep('building');
      const record = await getWithdrawTransactionRecord(transferServer, transactionId, auth.jwt);

      // Step 5 — Build payment
      const tx = await buildWithdrawPayment({
        sourcePublicKey: publicKey,
        anchorAccount: record.withdrawAnchorAccount,
        amount,
        memo: record.memo,
        memoType: record.memoType,
        assetCode: anchor.assetCode,
        assetIssuer: anchor.assetIssuer,
      });

      // Step 6 — Sign and submit
      setStep('signing');
      const result = await signAndSubmitPayment(tx);
      setTxHash(result.hash ?? null);
      setStep('done');

      // Hand tracking data to the page, then close so StatusTracker owns the viewport.
      if (transferServer) {
        onExecuteStarted(transactionId, transferServer, auth.jwt);
      }
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';

      // Determine if it's a "User Rejected" case to avoid noisy error UI
      if (message.includes('User rejected') || message.includes('User cancelled')) {
        setStep('idle'); // Just go back to idle instead of showing error screen
        return;
      }

      setErrorMsg(message);
      setStep('error');
    } finally {
      // Clean up global KYC handlers
      delete window.currentKycResolve;
      delete window.currentKycReject;
    }
  }

  const isRunning = !['idle', 'done', 'error'].includes(step);

  const handleKycComplete = (transactionId: string) => {
    if (window.currentKycResolve) {
      window.currentKycResolve(transactionId);
    }
  };

  const handleKycCancel = () => {
    if (window.currentKycReject) {
      window.currentKycReject(new Error('User cancelled the transaction'));
    }
  };

  const handleKycError = (error: Error) => {
    if (window.currentKycReject) {
      window.currentKycReject(error);
    }
  };

  const handleConfirmClose = () => {
    setShowConfirmDialog(false);
    if (window.currentKycReject) {
      window.currentKycReject(new Error('User cancelled the transaction'));
    }
    onClose();
  };

  const handleCancelClose = () => {
    setShowConfirmDialog(false);
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={isRunning ? undefined : onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Execute off-ramp"
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-white shadow-2xl transition-transform duration-300 dark:bg-gray-900 sm:bottom-auto sm:left-auto sm:right-8 sm:top-1/2 sm:w-96 sm:-translate-y-1/2 sm:rounded-2xl ${
          isOpen ? 'translate-y-0' : 'translate-y-full sm:translate-y-full'
        }`}
      >
        <div className="p-6">
          {/* Header */}
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Off-ramp via {rate?.anchorName ?? ''}
            </h2>
            <button
              onClick={onClose}
              disabled={isRunning}
              aria-label="Close"
              className="rounded-lg p-1 text-gray-400 hover:text-gray-600 disabled:opacity-40 dark:hover:text-gray-200"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Summary */}
          {rate && (
            <div className="mb-5 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">You send</dt>
                  <dd className="font-medium text-gray-900 dark:text-white">{amount} USDC</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Fee</dt>
                  <dd className="text-gray-700 dark:text-gray-300">{rate.fee} USDC</dd>
                </div>
                <div className="flex justify-between border-t border-gray-100 pt-2 dark:border-gray-700">
                  <dt className="font-medium text-gray-700 dark:text-gray-300">You receive</dt>
                  <dd className="font-semibold text-green-600 dark:text-green-400">
                    {(rate.totalReceived ?? 0).toLocaleString()}{' '}
                    {rate.corridorId.split('-')[1]?.toUpperCase()}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {/* KYC iframe */}
          {step === 'kyc' && kycUrl && kycOrigin && (
            <div className="mb-5">
              <KycIframe
                url={kycUrl}
                origin={kycOrigin}
                onComplete={handleKycComplete}
                onCancel={handleKycCancel}
                onError={handleKycError}
              />
            </div>
          )}

          {/* Step indicator - hide during KYC iframe */}
          {step !== 'kyc' && <StepIndicator step={step} />}

          {/* Error message */}
          {step === 'error' && errorMsg && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
              {errorMsg}
            </p>
          )}

          {/* Success — tx hash */}
          {step === 'done' && txHash && (
            <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs font-mono text-green-700 dark:bg-green-950/30 dark:text-green-400">
              {txHash}
            </p>
          )}

          {/* CTA - hide during KYC iframe */}
          {step !== 'kyc' && (
            <div className="mt-5">
              {step === 'idle' && (
                <button
                  onClick={handleExecute}
                  className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  Start Off-ramp
                </button>
              )}
              {isRunning && (
                <button
                  disabled
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white opacity-75"
                >
                  <Spinner />
                  {STEP_LABELS[step as Step]}
                </button>
              )}
              {step === 'error' && (
                <button
                  onClick={handleExecute}
                  className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                >
                  Try Again
                </button>
              )}
              {step === 'done' && (
                <button
                  onClick={onClose}
                  className="w-full rounded-xl bg-gray-100 py-3 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
                >
                  Close
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={handleCancelClose} />
          <div className="relative z-10 mx-4 max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
              Cancel Off-ramp?
            </h3>
            <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
              Are you sure you want to cancel the off-ramp process? This will close the KYC form and
              you'll need to start over.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleCancelClose}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Keep Going
              </button>
              <button
                onClick={handleConfirmClose}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              >
                Cancel Process
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Global window types for KYC handling
declare global {
  interface Window {
    currentKycResolve?: ((transactionId: string) => void) | null;
    currentKycReject?: ((error: Error) => void) | null;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const ORDERED_STEPS: Step[] = [
  'authenticating',
  'initiating',
  'kyc',
  'building',
  'signing',
  'done',
];

function StepIndicator({ step }: { step: Step }) {
  if (step === 'idle') return null;

  return (
    <ol className="space-y-1">
      {ORDERED_STEPS.map((s) => {
        const currentIdx = ORDERED_STEPS.indexOf(step === 'error' ? 'authenticating' : step);
        const thisIdx = ORDERED_STEPS.indexOf(s);
        const isComplete = step !== 'error' && thisIdx < ORDERED_STEPS.indexOf(step);
        const isActive = s === step && step !== 'error' && step !== 'done';
        const isPending = thisIdx > currentIdx && step !== 'done';

        return (
          <li key={s} className="flex items-center gap-2 text-xs">
            <span
              className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold
                ${isComplete ? 'bg-green-500 text-white' : ''}
                ${isActive ? 'bg-blue-600 text-white animate-pulse' : ''}
                ${isPending ? 'bg-gray-200 text-gray-400 dark:bg-gray-700' : ''}
                ${step === 'done' ? 'bg-green-500 text-white' : ''}
              `}
            >
              {isComplete || step === 'done' ? '✓' : thisIdx + 1}
            </span>
            <span
              className={
                isActive
                  ? 'font-medium text-blue-600 dark:text-blue-400'
                  : isComplete || step === 'done'
                    ? 'text-gray-500 line-through dark:text-gray-400'
                    : 'text-gray-400 dark:text-gray-500'
              }
            >
              {STEP_LABELS[s]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
