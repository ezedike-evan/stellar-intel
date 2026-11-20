'use client';

import { useEffect, useRef, useState } from 'react';
import { authenticate, NetworkMismatchError } from '@/lib/stellar/sep10';
import { startDepositFlow } from '@/lib/stellar/sep24';
import { getResolvedAnchorById } from '@/lib/stellar/anchors';
import { classifyExecuteError, isRetryableExecuteError } from '@/lib/errors/messages';
import { acceptTerms, hasAcceptedTerms } from '@/lib/consent';
import { Button } from '@/components/ui/Button';
import { ONRAMP_FUNNEL_EVENTS, amountBucket, trackFunnelEvent } from '@/lib/analytics';
import { ConsentModal } from '@/components/offramp/ConsentModal';
import { KycIframe } from '@/components/offramp/KycIframe';
import { TrustlinePreflight } from './TrustlinePreflight';
import type { DepositRate } from '@/types';

// ─── Steps ────────────────────────────────────────────────────────────────────

export type DepositDrawerStep =
  'idle' | 'preflight' | 'authenticating' | 'initiating' | 'interactive' | 'done' | 'error';

const STEP_LABELS: Record<DepositDrawerStep, string> = {
  idle: 'Ready',
  preflight: 'Checking your wallet can receive the asset…',
  authenticating: 'Proving wallet ownership to the anchor…',
  initiating: 'Opening the anchor’s deposit window…',
  interactive: 'Complete the deposit in the anchor’s window',
  done: 'Deposit started',
  error: 'Something went wrong',
};

const ORDERED_STEPS: DepositDrawerStep[] = [
  'preflight',
  'authenticating',
  'initiating',
  'interactive',
];

const CANCELLED = 'User cancelled the transaction';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DepositDrawerProps {
  rate: DepositRate | null;
  /** Fiat amount the user intends to deposit, shown to them. The anchor is sent asset units. */
  amount: string;
  publicKey: string;
  onClose: () => void;
  onDepositStarted: (
    transactionId: string,
    transferServer: string,
    jwt: string,
    anchorHomeDomain: string
  ) => void;
}

/** `stellar:CODE:ISSUER` / `stellar:native` → the asset's code and issuer. */
function parseAssetId(assetId: string): { code: string; issuer: string } {
  if (assetId === 'stellar:native') return { code: 'XLM', issuer: '' };
  const [, code = '', issuer = ''] = assetId.split(':');
  return { code, issuer };
}

/**
 * SEP-24 reads `amount` in units of the asset being deposited, not in the fiat the
 * user pays, so the row's gross asset amount is what goes to the anchor. Seven
 * decimals is Stellar's precision; trailing zeros are dropped.
 */
export function toAssetAmount(assetAmount: number | undefined): string {
  if (assetAmount === undefined || !Number.isFinite(assetAmount) || assetAmount <= 0) {
    throw new Error(
      'This estimate has no asset amount to start a deposit from. Refresh the rates.'
    );
  }
  return assetAmount
    .toFixed(7)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Starts a deposit: trustline preflight, SEP-10 authentication, then the
 * anchor's interactive SEP-24 window. There is no payment for the user to sign;
 * the fiat is paid to the anchor from inside its own window. Every figure shown
 * is an estimate, because the anchor sets the final rate there.
 */
export function DepositDrawer({
  rate,
  amount,
  publicKey,
  onClose,
  onDepositStarted,
}: DepositDrawerProps) {
  const [step, setStep] = useState<DepositDrawerStep>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorIsRetryable, setErrorIsRetryable] = useState(true);
  const [interactive, setInteractive] = useState<{ url: string; origin: string } | null>(null);
  const [showConsent, setShowConsent] = useState(false);

  // Settle the awaits inside handleDeposit from component callbacks, without
  // reaching for window globals.
  const preflightResolveRef = useRef<(() => void) | null>(null);
  const preflightRejectRef = useRef<((error: Error) => void) | null>(null);
  const kycResolveRef = useRef<((transactionId: string) => void) | null>(null);
  const kycRejectRef = useRef<((error: Error) => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const drawerRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const isOpen = rate !== null;
  const isRunning = !['idle', 'done', 'error'].includes(step);
  const asset = rate ? parseAssetId(rate.asset) : null;
  const fiat = rate?.corridorId.split('-')[1]?.toUpperCase() ?? '';

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // A fresh drawer for a different anchor starts from the top.
  const rateKey = rate ? `${rate.anchorId}:${rate.asset}` : null;
  useEffect(() => {
    setStep('idle');
    setErrorMsg(null);
    setInteractive(null);
  }, [rateKey]);

  // Focus trap, Escape and focus restore, as in the off-ramp ExecuteDrawer.
  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    return () => previouslyFocusedRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || showConsent) return;
    const getFocusable = () =>
      drawerRef.current
        ? Array.from(
            drawerRef.current.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'
            )
          )
        : [];
    getFocusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (step === 'idle' || step === 'error')) {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, showConsent, step, onClose]);

  // Pin the page behind the drawer; position:fixed is what holds on iOS Safari.
  useEffect(() => {
    if (!isOpen) return;
    const { body } = document;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  async function handleDeposit() {
    if (!rate || !asset) return;

    // First deposit for this wallet needs the Terms acknowledged. Gated here, not
    // on the button, so the error-state Retry is covered too.
    if (!hasAcceptedTerms(publicKey)) {
      setShowConsent(true);
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    setErrorMsg(null);
    setInteractive(null);

    try {
      // Step 1 — the wallet must exist and hold a trustline, or the payout cannot land.
      setStep('preflight');
      await new Promise<void>((resolve, reject) => {
        preflightResolveRef.current = resolve;
        preflightRejectRef.current = reject;
      });
      preflightResolveRef.current = null;
      preflightRejectRef.current = null;

      // Step 2 — SEP-10.
      setStep('authenticating');
      const anchor = await getResolvedAnchorById(rate.anchorId);
      const auth = await authenticate(anchor, publicKey);

      // Step 3 — open the interactive deposit.
      setStep('initiating');
      const session = await startDepositFlow(
        anchor,
        {
          jwt: auth.jwt,
          assetCode: asset.code,
          assetIssuer: asset.issuer,
          amount: toAssetAmount(rate.assetAmount),
          account: publicKey,
        },
        signal
      );

      // Step 4 — the anchor's window, where KYC and the fiat payment happen.
      setInteractive({ url: session.depositUrl, origin: new URL(session.depositUrl).origin });
      setStep('interactive');
      trackFunnelEvent(ONRAMP_FUNNEL_EVENTS.onrampDepositStarted, {
        direction: 'onramp',
        corridor: rate.corridorId,
        anchor: rate.anchorId,
        amount_bucket: amountBucket(amount),
      });
      const transactionId = await new Promise<string>((resolve, reject) => {
        kycResolveRef.current = resolve;
        kycRejectRef.current = reject;
      });
      kycResolveRef.current = null;
      kycRejectRef.current = null;

      setStep('done');
      onDepositStarted(transactionId, session.transferServer, auth.jwt, anchor.homeDomain);
      onClose();
    } catch (err) {
      // Wrong Freighter network: tell the user to switch, never retry the sign.
      if (err instanceof NetworkMismatchError) {
        setErrorMsg(err.message);
        setErrorIsRetryable(false);
        setStep('error');
        return;
      }

      if ((err as Error).name === 'AbortError') return;

      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('User rejected') || message.includes('User cancelled')) {
        setInteractive(null);
        setStep('idle');
        return;
      }

      setErrorMsg(classifyExecuteError(err));
      setErrorIsRetryable(isRetryableExecuteError(err));
      setStep('error');
    } finally {
      preflightResolveRef.current = null;
      preflightRejectRef.current = null;
      kycResolveRef.current = null;
      kycRejectRef.current = null;
    }
  }

  const handleConsentAccept = () => {
    acceptTerms(publicKey);
    setShowConsent(false);
    void handleDeposit();
  };

  const handleCancel = () => {
    preflightRejectRef.current?.(new Error(CANCELLED));
    kycRejectRef.current?.(new Error(CANCELLED));
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={isRunning ? undefined : onClose}
        aria-hidden="true"
      />

      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Deposit"
        aria-hidden={!isOpen}
        className={`bg-bg-subtle fixed right-0 bottom-0 left-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-2xl transition-transform duration-300 motion-reduce:transition-none lg:top-1/2 lg:right-auto lg:bottom-auto lg:left-1/2 lg:w-full lg:max-w-[480px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-2xl ${
          isOpen ? 'translate-y-0' : 'translate-y-full lg:translate-y-full'
        }`}
      >
        <div className="px-6 pt-5 pb-6 sm:p-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-primary-text text-lg font-semibold">
              Deposit via {rate?.anchorName ?? ''}
            </h2>
            <button
              onClick={onClose}
              disabled={isRunning}
              aria-label="Close"
              className="text-secondary-text hover:text-primary-text focus-visible:ring-accent rounded-lg p-1 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40"
            >
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {rate && asset && (
            <div className="border-border mb-5 rounded-xl border p-4">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-fg-muted">You pay</dt>
                  <dd className="text-primary-text font-medium tabular-nums">
                    {amount} {fiat}
                  </dd>
                </div>
                {rate.fee !== null && (
                  <div className="flex justify-between">
                    <dt className="text-fg-muted">Fee</dt>
                    <dd className="text-secondary-text tabular-nums">
                      {rate.fee} {asset.code}
                    </dd>
                  </div>
                )}
                <div className="border-border flex justify-between border-t pt-2">
                  <dt className="text-secondary-text font-medium">Estimated credit</dt>
                  <dd className="text-primary-text font-semibold tabular-nums">
                    {rate.totalReceived === null
                      ? '—'
                      : `≈ ${rate.totalReceived.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${asset.code}`}
                  </dd>
                </div>
              </dl>
              <p className="text-fg-muted mt-3 text-xs">
                Estimate only. The anchor sets the final rate and fees in its deposit window.
              </p>
            </div>
          )}

          {step === 'preflight' && asset && (
            <div className="mb-5">
              <TrustlinePreflight
                publicKey={publicKey}
                asset={asset}
                onReady={() => preflightResolveRef.current?.()}
                amount={amount}
              />
            </div>
          )}

          {step === 'interactive' && interactive && (
            <div className="mb-5">
              <KycIframe
                url={interactive.url}
                origin={interactive.origin}
                onComplete={(transactionId) => kycResolveRef.current?.(transactionId)}
                onCancel={() => kycRejectRef.current?.(new Error(CANCELLED))}
                onError={(error) => kycRejectRef.current?.(error)}
              />
            </div>
          )}

          {step !== 'idle' && step !== 'interactive' && <StepIndicator step={step} />}

          {step === 'error' && errorMsg && (
            <p
              role="alert"
              className="bg-bg-sunken text-status-down mt-3 rounded-lg px-3 py-2 text-sm"
            >
              {errorMsg}
            </p>
          )}

          <div className="mt-5 flex gap-3">
            {step === 'idle' && (
              <Button className="w-full" onClick={() => void handleDeposit()}>
                Start deposit
              </Button>
            )}
            {(step === 'preflight' || step === 'interactive') && (
              <Button variant="secondary" className="w-full" onClick={handleCancel}>
                Cancel deposit
              </Button>
            )}
            {(step === 'authenticating' || step === 'initiating') && (
              <Button className="w-full" disabled>
                {STEP_LABELS[step]}
              </Button>
            )}
            {step === 'error' && (
              <Button
                className="w-full"
                variant={errorIsRetryable ? 'primary' : 'secondary'}
                onClick={errorIsRetryable ? () => void handleDeposit() : onClose}
              >
                {errorIsRetryable ? 'Retry' : 'Close'}
              </Button>
            )}
          </div>
        </div>
      </div>

      <ConsentModal
        open={showConsent}
        onAccept={handleConsentAccept}
        onCancel={() => setShowConsent(false)}
      />
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: DepositDrawerStep }) {
  const currentIdx = ORDERED_STEPS.indexOf(step);

  return (
    <ol className="space-y-1" aria-label="Deposit progress">
      {ORDERED_STEPS.map((s, idx) => {
        const isComplete = step === 'done' || (currentIdx !== -1 && idx < currentIdx);
        const isActive = s === step;

        return (
          <li
            key={s}
            aria-current={isActive ? 'step' : undefined}
            className="flex items-center gap-2 text-xs"
          >
            <span
              aria-hidden="true"
              className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                isComplete
                  ? 'bg-status-up text-background'
                  : isActive
                    ? 'bg-accent text-background animate-pulse'
                    : 'bg-bg-sunken text-fg-muted'
              }`}
            >
              {idx + 1}
            </span>
            <span
              className={
                isActive
                  ? 'text-accent font-medium'
                  : isComplete
                    ? 'text-fg-muted line-through'
                    : 'text-secondary-text'
              }
            >
              {STEP_LABELS[s]}
              {isComplete && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
