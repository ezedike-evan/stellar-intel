'use client';
import { useState, useEffect, useRef } from 'react';
import { TYPICAL_AMOUNTS } from '@/constants/anchors';

const POSITIVE_DECIMAL_RE = /^\d*\.?\d{0,7}$/;

const DEFAULT_SUGGESTED_AMOUNTS = [50, 100, 500];

function formatChipLabel(value: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `$${value}`;
  }
}

function validate(raw: string): string | null {
  if (!POSITIVE_DECIMAL_RE.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return raw;
}

interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Connected wallet's USDC balance (null = no trustline / not connected). */
  balance?: number | null;
  isBalanceLoading?: boolean;
  /** Selects corridor-specific "typical amount" chips when defined; falls back to defaults otherwise. */
  corridorId?: string;
}

export function AmountInput({
  value,
  onChange,
  disabled,
  balance,
  isBalanceLoading,
  corridorId,
}: AmountInputProps) {
  const [raw, setRaw] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suggestedAmounts = (corridorId && TYPICAL_AMOUNTS[corridorId]) || DEFAULT_SUGGESTED_AMOUNTS;

  const numericRaw = Number(raw);
  const insufficient =
    balance != null && Number.isFinite(numericRaw) && numericRaw > 0 && numericRaw > balance;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRaw(value);

    setError(null);
  }, [value]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleChipClick(value: number) {
    const str = String(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setRaw(str);
    setError(null);
    onChange(str);
  }

  function handleMaxClick() {
    if (balance == null) return;
    const floored = Math.floor(balance * 100) / 100;
    handleChipClick(floored);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target.value;
    setRaw(input);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (input === '') {
      setError(null);
      debounceRef.current = setTimeout(() => onChange(''), 250);
      return;
    }

    if (input.endsWith('.')) {
      setError(null);
      return;
    }

    const validated = validate(input);
    if (validated === null) {
      setError('Enter a positive number with up to 7 decimal places');
      return;
    }

    setError(null);
    debounceRef.current = setTimeout(() => onChange(validated), 250);
  }

  return (
    <div>
      <label
        htmlFor="amount-input"
        className="mb-1.5 block text-sm font-medium text-secondary-text"
      >
        Amount (USDC)
      </label>
      <div className="relative">
        <input
          id="amount-input"
          type="text"
          inputMode="decimal"
          value={raw}
          onChange={handleChange}
          disabled={disabled}
          aria-invalid={error !== null || insufficient}
          aria-describedby={
            error ? 'amount-error' : insufficient ? 'amount-insufficient' : 'amount-hint'
          }
          className={`w-full rounded-lg border py-2.5 pl-3 text-sm text-primary-text focus:outline-none focus:ring-2 disabled:opacity-50 ${
            balance != null && balance > 0 ? 'pr-28' : 'pr-16'
          } ${
            error || insufficient
              ? 'border-status-down/40 bg-bg-sunken focus:border-status-down/40 focus:ring-status-down/20  '
              : 'border-control-border bg-bg-subtle focus:border-accent focus:ring-accent/20 '
          }`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-1.5 text-sm font-medium text-secondary-text">
          {balance != null && balance > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={handleMaxClick}
              className="pointer-events-auto rounded-md border border-control-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-secondary-text hover:border-border hover:text-accent disabled:opacity-50 dark:hover:border-accent dark:hover:text-accent"
            >
              Max
            </button>
          )}
          USDC
        </span>
      </div>
      {!isBalanceLoading && balance != null && (
        <p className="mt-1 text-xs text-fg-muted">
          Balance: {balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
        </p>
      )}
      <div className="mt-2 flex gap-2">
        {suggestedAmounts.map((amount) => (
          <button
            key={amount}
            type="button"
            disabled={disabled}
            onClick={() => handleChipClick(amount)}
            className="rounded-md border border-control-border bg-bg-subtle px-3 py-1 text-xs font-medium text-secondary-text transition-colors hover:border-border hover:bg-accent-subtle hover:text-accent disabled:opacity-50 dark:hover:border-accent dark:hover:bg-bg-sunken dark:hover:text-accent"
          >
            {formatChipLabel(amount)}
          </button>
        ))}
      </div>
      {error ? (
        <p id="amount-error" role="alert" className="mt-1 text-xs text-status-down">
          {error}
        </p>
      ) : insufficient ? (
        <p id="amount-insufficient" role="alert" className="mt-1 text-xs text-status-down">
          Insufficient balance
        </p>
      ) : (
        <p id="amount-hint" className="mt-1 text-xs text-fg-muted">
          Enter the amount of USDC to off-ramp
        </p>
      )}
    </div>
  );
}
