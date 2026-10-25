'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  buildChangeTrustTx,
  checkDepositPreflight,
  signAndSubmitPayment,
} from '@/lib/stellar/horizon';

interface TrustlinePreflightProps {
  publicKey: string;
  asset: { code: string; issuer: string };
  /** Called once when the wallet can receive the asset. */
  onReady: () => void;
}

type PreflightState =
  | { kind: 'checking' }
  | { kind: 'no-account' }
  | { kind: 'no-trustline' }
  | { kind: 'unauthorized' }
  | { kind: 'ready' }
  | { kind: 'check-failed'; message: string };

/**
 * The gate in front of an on-ramp deposit: the wallet has to exist and hold a
 * trustline for the asset, or the anchor's payout cannot land and the user would
 * finish KYC and pay fiat for nothing. Each way it can fail gets its own message
 * and, where the user can fix it, the action to do so.
 */
export function TrustlinePreflight({ publicKey, asset, onReady }: TrustlinePreflightProps) {
  const [state, setState] = useState<PreflightState>({ kind: 'checking' });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | undefined>();
  // Bumped to re-run the check (Retry, or after adding the trustline).
  const [attempt, setAttempt] = useState(0);
  const notifiedFor = useRef<string | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const { code, issuer } = asset;
  const checkKey = `${publicKey}:${code}:${issuer}`;

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'checking' });

    checkDepositPreflight(publicKey, { code, issuer }).then(
      (result) => {
        if (cancelled) return;
        if (!result.accountExists) setState({ kind: 'no-account' });
        else if (!result.hasTrustline) setState({ kind: 'no-trustline' });
        else if (result.trustlineAuthorized === false) setState({ kind: 'unauthorized' });
        else setState({ kind: 'ready' });
      },
      (err: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'check-failed',
          message: err instanceof Error ? err.message : 'Could not check your wallet.',
        });
      }
    );

    return () => {
      cancelled = true;
    };
  }, [publicKey, code, issuer, attempt]);

  // Fire onReady once per wallet and asset, however many times the check re-runs.
  useEffect(() => {
    if (state.kind === 'ready' && notifiedFor.current !== checkKey) {
      notifiedFor.current = checkKey;
      onReadyRef.current();
    }
  }, [state, checkKey]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const addTrustline = useCallback(async () => {
    setAdding(true);
    setAddError(undefined);
    try {
      const tx = await buildChangeTrustTx({
        sourcePublicKey: publicKey,
        assetCode: code,
        assetIssuer: issuer,
      });
      await signAndSubmitPayment(tx);
      setAttempt((n) => n + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Declining in Freighter is a choice, not an error: back to the prompt, no banner.
      if (!message.includes('User rejected') && !message.includes('User cancelled')) {
        setAddError(message);
      }
    } finally {
      setAdding(false);
    }
  }, [publicKey, code, issuer]);

  return (
    <div className="border-border rounded-xl border p-4" aria-busy={state.kind === 'checking'}>
      <div aria-live="polite" className="text-sm">
        {state.kind === 'checking' && <p className="text-secondary-text">Checking your wallet…</p>}

        {state.kind === 'no-account' && (
          <p className="text-primary-text">
            {
              "This wallet isn't active on Stellar yet. Fund it with at least 1.5 XLM from an exchange or another wallet, then retry."
            }
          </p>
        )}

        {state.kind === 'no-trustline' && (
          <p className="text-primary-text">
            Your wallet needs a trustline for {code} before it can receive it.
          </p>
        )}

        {state.kind === 'unauthorized' && (
          <p className="text-primary-text">
            {`The issuer hasn't authorised your ${code} trustline yet.`}
          </p>
        )}

        {state.kind === 'ready' && (
          <p className="text-status-up">Your wallet is ready to receive {code}.</p>
        )}

        {state.kind === 'check-failed' && (
          <p className="text-status-down">{`Could not check your wallet: ${state.message}`}</p>
        )}
      </div>

      {addError && (
        <p role="alert" className="bg-bg-sunken text-status-down mt-3 rounded-lg px-3 py-2 text-sm">
          {addError}
        </p>
      )}

      {(state.kind === 'no-account' || state.kind === 'check-failed') && (
        <Button variant="secondary" className="mt-3" onClick={retry}>
          Retry
        </Button>
      )}

      {state.kind === 'no-trustline' && (
        <Button className="mt-3 w-full" onClick={addTrustline} disabled={adding}>
          {adding ? `Adding ${code} trustline…` : `Add ${code} trustline`}
        </Button>
      )}
    </div>
  );
}
