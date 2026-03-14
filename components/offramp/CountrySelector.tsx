'use client'
import { SUPPORTED_COUNTRIES } from '@/constants'
import type { Country } from '@/types'

interface CountrySelectorProps {
  value: string
  onChange: (country: Country) => void
}

export function CountrySelector({ value, onChange }: CountrySelectorProps) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
        Country
      </label>
      <select
        value={value}
        onChange={(e) => {
          const c = SUPPORTED_COUNTRIES.find((c) => c.code === e.target.value)
          if (c) onChange(c)
        }}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
      >
        {SUPPORTED_COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.flag} {c.name} ({c.currency})
          </option>
        ))}
      </select>
    </div>
  )
}
