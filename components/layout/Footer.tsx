import Link from 'next/link'
import { Zap } from 'lucide-react'

export function Footer() {
  return (
    <footer className="border-t border-gray-200 dark:border-gray-800">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400">
            <Zap className="h-4 w-4 text-blue-600" />
            Stellar Intel — Real-time rate comparison on Stellar
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-600">
            Built on{' '}
            <a
              href="https://stellar.org"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              Stellar
            </a>{' '}
            · Submitted for SCF
          </p>
        </div>
      </div>
    </footer>
  )
}
