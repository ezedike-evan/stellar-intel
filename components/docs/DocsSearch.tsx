'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { clsx } from 'clsx';
import { DOCS_ROUTES } from '@/app/docs/nav';

interface DocsSearchProps {
  open: boolean;
  onClose: () => void;
}

export function DocsSearch({ open, onClose }: DocsSearchProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const results = DOCS_ROUTES.filter((r) => r.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      inputRef.current?.focus();
    }
  }, [open]);

  function close() {
    setQuery('');
    onClose();
  }

  function navigate(href: string) {
    router.push(href);
    close();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const hit = results[activeIndex];
      if (hit) navigate(hit.href);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[20vh]"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search docs"
        className="w-full max-w-lg rounded-2xl bg-background shadow-lg"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-secondary-text" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search docs..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            className="flex-1 bg-transparent text-sm text-primary-text placeholder:text-secondary-text focus:outline-none"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-xs text-secondary-text">
            Esc
          </kbd>
        </div>
        <ul className="max-h-64 overflow-y-auto p-2" role="listbox">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-secondary-text">No results found.</li>
          ) : (
            results.map((route, i) => {
              const Icon = route.icon;
              return (
                <li key={route.href} role="option" aria-selected={i === activeIndex}>
                  <button
                    type="button"
                    onClick={() => navigate(route.href)}
                    className={clsx(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                      i === activeIndex
                        ? 'bg-accent/10 text-accent'
                        : 'text-secondary-text hover:bg-bg-subtle hover:text-primary-text'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {route.label}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
