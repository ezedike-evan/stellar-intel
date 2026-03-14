'use client'
import { SUPPORTED_ASSETS } from '@/constants'
import type { StellarAsset } from '@/types'

interface AssetSelectorProps {
  label: string
  value: StellarAsset | null
  onChange: (asset: StellarAsset) => void
  exclude?: StellarAsset | null
}

export function AssetSelector({ label, value, onChange, exclude }: AssetSelectorProps) {
  const options = SUPPORTED_ASSETS.filter((a) => a.code !== exclude?.code)
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      <select
        value={value?.code ?? ''}
        onChange={(e) => {
          const a = options.find((a) => a.code === e.target.value)
          if (a) onChange(a)
        }}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
      >
        <option value="">Select asset…</option>
        {options.map((a) => (
          <option key={a.code} value={a.code}>
            {a.code} — {a.name}
          </option>
        ))}
      </select>
    </div>
  )
}
