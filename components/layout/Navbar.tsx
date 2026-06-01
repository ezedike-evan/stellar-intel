'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { Sun, Moon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { detectMcp } from '@/lib/mcp/detect';

const NAV_LINKS = [
  { href: '/offramp', label: 'Off-ramp' },
  { href: '/anchors', label: 'Anchors' },
];

export function Navbar() {
  const pathname = usePathname();
  const { dark, toggle } = useTheme();
  const [mcpPresent, setMcpPresent] = useState(false);

  useEffect(() => {
    detectMcp().then(setMcpPresent);
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Link href="/" className="font-bold text-primary-text">
            Stellar Intel
          </Link>
          {mcpPresent && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              Open in MCP
            </span>
          )}
        </div>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                pathname === href
                  ? 'bg-primary-text/10 text-accent'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
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
  );
}
