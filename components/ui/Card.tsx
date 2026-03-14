import { clsx } from 'clsx'
import type { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean
}

export function Card({ selected, className, ...props }: CardProps) {
  return (
    <div
      className={clsx(
        'rounded-xl border bg-white p-4 shadow-sm transition-colors dark:bg-gray-900',
        selected
          ? 'border-blue-500 ring-2 ring-blue-500'
          : 'border-gray-200 dark:border-gray-700',
        className,
      )}
      {...props}
    />
  )
}
