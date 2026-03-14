'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'
import { Sun, Moon, Zap } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useTheme } from '@/hooks/useTheme'

const NAV_LINKS = [
  { href: '/offramp', label: 'Off-ramp' },
  { href: '/onramp', label: 'On-ramp' },
  { href: '/yield', label: 'Yield' },
  { href: '/swap', label: 'Swap' },
]

export function Navbar() {
  const pathname = usePathname()
  const { dark, toggle } = useTheme()
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-bold text-primary-text">
          Stellar Intel
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                pathname === href
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <Button variant="ghost" size="sm" onClick={toggle} aria-label="Toggle theme">
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>
    </header>
  )
}
