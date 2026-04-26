'use client';

interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * Controlled numeric input for USDC amounts.
 * Rejects negative values and enforces a maximum of 2 decimal places.
 */
export function AmountInput({ value, onChange, disabled }: AmountInputProps) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;

    // Allow empty string for clearing the field
    if (raw === '') {
      onChange('');
      return;
    }

    const num = Number(raw);
    if (num < 0) return;

    // Enforce max 2 decimal places
    if (/\.\d{3,}$/.test(raw)) return;

    onChange(raw);
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
        Amount (USDC)
      </label>
      <div className="relative">
        <input
          type="number"
          min={0}
          step="0.01"
          value={value}
          onChange={handleChange}
          disabled={disabled}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 pr-16 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-medium text-gray-400">
          USDC
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Enter the amount of USDC to off-ramp
      </p>
    </div>
  );
}
