import { CheckIcon } from 'lucide-react'
import type { WithdrawStatusValue } from '@/types'
import { mapToCanonical } from '@/lib/stellar/sep24-status-map'

export interface TimelineProps {
  status: WithdrawStatusValue | undefined
}

const STAGES = [
  { id: 'pending_user_action', label: 'User Action Required' },
  { id: 'pending_anchor', label: 'Processing at Anchor' },
  { id: 'pending_stellar', label: 'Confirming on Stellar' },
  { id: 'pending_external', label: 'Sending to Bank' },
  { id: 'completed', label: 'Completed' },
] as const

type StageId = (typeof STAGES)[number]['id']

export function Timeline({ status }: TimelineProps) {
  const canonical = status ? mapToCanonical(status) : undefined

  // If terminal error state, we might still want to show where it stopped,
  // but for simplicity, we map canonical progress index.
  const currentIndex = STAGES.findIndex((s) => s.id === canonical)

  // If the state is not in the STAGES list (e.g. error, refunded), 
  // we either highlight the last known step or we just rely on currentIndex being -1.
  // Actually, if it's refunded/error, we could just not render the timeline or render it halted.
  // We'll render it up to where we know, but since canonical won't match, currentIndex is -1.
  // Let's assume if canonical is an error state, we still want to show something.
  // For now, let's just use currentIndex to determine active/past/future.
  
  const activeIndex = currentIndex >= 0 ? currentIndex : 0
  const isTerminalError = ['error', 'refunded', 'no_market', 'expired'].includes(canonical ?? '')

  return (
    <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800" aria-label="Transaction progress timeline">
      <h4 className="sr-only">Progress Timeline</h4>
      <div className="space-y-4">
        {STAGES.map((stage, idx) => {
          const isCompleted = idx < activeIndex || canonical === 'completed'
          const isActive = idx === activeIndex && !isTerminalError && canonical !== 'completed'
          const isFuture = idx > activeIndex || (idx === activeIndex && isTerminalError)

          return (
            <div
              key={stage.id}
              className="relative flex items-start gap-3"
              aria-current={isActive ? 'step' : undefined}
            >
              {/* Connector line */}
              {idx < STAGES.length - 1 && (
                <div
                  className={`absolute left-2.5 top-6 h-full w-px -translate-x-1/2 ${
                    idx < activeIndex ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                  aria-hidden="true"
                />
              )}

              {/* Icon / Dot */}
              <div className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white dark:bg-gray-900">
                {isCompleted ? (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-white">
                    <CheckIcon className="h-3 w-3" strokeWidth={3} />
                  </div>
                ) : isActive ? (
                  <div className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse" />
                ) : (
                  <div className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" />
                )}
              </div>

              {/* Label */}
              <div className="mt-0.5 flex flex-col">
                <span
                  className={`text-sm font-medium ${
                    isActive
                      ? 'text-gray-900 dark:text-white'
                      : isCompleted
                      ? 'text-gray-700 dark:text-gray-300'
                      : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {stage.label}
                  <span className="sr-only">
                    {isCompleted ? ' (Completed)' : isActive ? ' (Current stage)' : ' (Pending)'}
                  </span>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
