'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { Sun, Moon, AlertTriangle, Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useTheme } from '@/hooks/useTheme';
import { detectMcp } from '@/lib/mcp/detect';

interface PublisherHealth {
  lastRun: string | null;
  lastBatchSize: number | null;
  lastError: string | null;
  staleSinceMs: number | null;
}

const STALE_THRESHOLD_MS = 15 * 60 * 1000;

const NAV_LINKS = [
  { href: '/offramp', label: 'Off-ramp' },
  { href: '/anchors', label: 'Anchors' },
  { href: '/docs', label: 'Docs' },
];

export function Header() {
  const pathname = usePathname();
  const { dark, toggle } = useTheme();
  const [mcpPresent, setMcpPresent] = useState(false);
  const [publisherStale, setPublisherStale] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    detectMcp().then(setMcpPresent);
  }, []);

  useEffect(() => {
    const checkPublisherHealth = async () => {
      try {
        const res = await fetch('/api/publisher/health');
        if (res.ok) {
          const health: PublisherHealth = await res.json();
          const isStale = health.staleSinceMs !== null && health.staleSinceMs > STALE_THRESHOLD_MS;
          setPublisherStale(isStale);
        }
      } catch {
        // publisher health is optional
      }
    };
    void checkPublisherHealth();
    const interval = setInterval(checkPublisherHealth, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          {/* The wordmark is type, not an image.
              `/wordmark.svg` carried a viewBox with no width or height, so it
              resolved to 0x0 and rendered as a broken image with its alt text
              showing — on every page of the live site. It was also a
              purple-to-teal gradient, which is no longer the identity. Setting
              it in Archivo at the expanded width axis removes the asset,
              adapts to both themes for free, and lets the identity typeface do
              the work a logo file was doing badly. */}
          <Link
            href="/"
            aria-label="Stellar Intel — home"
            className="focus-visible:ring-accent focus-visible:ring-offset-background inline-flex h-11 items-center rounded-sm pr-2 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <span className="text-[15px] leading-none font-bold tracking-[0.02em] whitespace-nowrap [font-variation-settings:'wdth'_125]">
              STELLAR INTEL
            </span>
          </Link>
          {mcpPresent && (
            <Badge variant="success">
              <span className="bg-status-up mr-1.5 inline-block h-1.5 w-1.5 rounded-full" />
              open in mcp
            </Badge>
          )}
          {publisherStale && (
            <Badge variant="warning">
              <AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />
              publisher stale
            </Badge>
          )}
        </div>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? 'page' : undefined}
              className={clsx(
                'inline-flex h-11 items-center rounded-sm px-3 text-sm font-medium',
                'transition-colors duration-100 ease-out',
                'focus-visible:ring-accent focus-visible:ring-offset-background',
                'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
                pathname === href
                  ? 'text-primary-text bg-bg-subtle'
                  : 'text-secondary-text hover:text-primary-text hover:bg-bg-subtle'
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1">
          <Button variant="ghost" onClick={toggle} aria-label="Toggle theme" className="w-11 px-0">
            {dark ? (
              <Sun className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
          <button
            ref={menuButtonRef}
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
            className="text-secondary-text hover:text-primary-text hover:bg-bg-subtle focus-visible:ring-accent focus-visible:ring-offset-background inline-flex h-11 w-11 items-center justify-center rounded-sm transition-colors duration-100 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none md:hidden"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="mobile-menu"
          aria-label="Mobile navigation"
          className="border-t border-border bg-background px-4 py-2 md:hidden"
        >
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? 'page' : undefined}
              className={clsx(
                'block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                pathname === href
                  ? 'bg-primary-text/10 text-accent'
                  : 'text-secondary-text hover:bg-bg-sunken dark:text-fg-muted dark:hover:bg-bg-sunken'
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
