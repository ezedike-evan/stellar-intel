'use client'

interface CurrencySelectorProps {
  currency: string
  currencySymbol: string
}

export function CurrencyDisplay({ currency, currencySymbol }: CurrencySelectorProps) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
        Currency
      </label>
      <div className="flex items-center rounded-lg border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300">
        {currencySymbol} {currency}
      </div>
    </div>
  )
}
