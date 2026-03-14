import { clsx } from 'clsx'
import type { RiskLevel } from '@/types'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'mock'
  risk?: RiskLevel
}

export function Badge({ children, variant, risk }: BadgeProps) {
  const resolvedVariant = risk
    ? ({ low: 'success', medium: 'warning', high: 'danger' } as const)[risk]
    : variant ?? 'default'

  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        {
          'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300': resolvedVariant === 'default',
          'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400': resolvedVariant === 'success',
          'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400': resolvedVariant === 'warning',
          'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400': resolvedVariant === 'danger',
          'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400': resolvedVariant === 'info',
          'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400': resolvedVariant === 'mock',
        },
      )}
    >
      {children}
    </span>
  )
}
