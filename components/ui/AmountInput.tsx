'use client'
import { useState, useEffect, useRef } from 'react'

const POSITIVE_DECIMAL_RE = /^\d*\.?\d{0,7}$/

const SUGGESTED_AMOUNTS = [50, 100, 500]

function formatChipLabel(value: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `$${value}`
  }
}

function validate(raw: string): string | null {
  if (!POSITIVE_DECIMAL_RE.test(raw)) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return raw
}

interface AmountInputProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export function AmountInput({ value, onChange, disabled }: AmountInputProps) {
  const [raw, setRaw] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setRaw(value)
    setError(null)
  }, [value])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  function handleChipClick(value: number) {
    const str = String(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setRaw(str)
    setError(null)
    onChange(str)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target.value
    setRaw(input)

    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (input === '') {
      setError(null)
      debounceRef.current = setTimeout(() => onChange(''), 250)
      return
    }

    if (input.endsWith('.')) {
      setError(null)
      return
    }

    const validated = validate(input)
    if (validated === null) {
      setError('Enter a positive number with up to 7 decimal places')
      return
    }

    setError(null)
    debounceRef.current = setTimeout(() => onChange(validated), 250)
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
        Amount (USDC)
      </label>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={raw}
          onChange={handleChange}
          disabled={disabled}
          aria-invalid={error !== null}
          aria-describedby={error ? 'amount-error' : 'amount-hint'}
          className={`w-full rounded-lg border px-3 py-2.5 pr-16 text-sm text-gray-900 focus:outline-none focus:ring-2 disabled:opacity-50 dark:text-white ${
            error
              ? 'border-red-400 bg-red-50 focus:border-red-500 focus:ring-red-500/20 dark:border-red-700 dark:bg-red-950/20'
              : 'border-gray-300 bg-white focus:border-blue-500 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800'
          }`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-medium text-gray-400">
          USDC
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        {SUGGESTED_AMOUNTS.map((amount) => (
          <button
            key={amount}
            type="button"
            disabled={disabled}
            onClick={() => handleChipClick(amount)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:bg-blue-950/30 dark:hover:text-blue-400"
          >
            {formatChipLabel(amount)}
          </button>
        ))}
      </div>
      {error ? (
        <p id="amount-error" role="alert" className="mt-1 text-xs text-red-500">
          {error}
        </p>
      ) : (
        <p id="amount-hint" className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Enter the amount of USDC to off-ramp
        </p>
      )}
    </div>
  )
}
