'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { BookOpen, ChevronRight } from 'lucide-react';
import { DOCS_SECTIONS } from './nav';
import { useState } from 'react';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      {/* Mobile sidebar toggle */}
      <button
        type="button"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white shadow-lg md:hidden"
      >
        <BookOpen className="h-4 w-4" />
        Docs Menu
      </button>

      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 w-64 transform border-r border-border bg-background pt-16 transition-transform duration-200 md:sticky md:top-16 md:block md:h-[calc(100vh-4rem)] md:translate-x-0 md:overflow-y-auto',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <nav className="space-y-6 p-4">
          {DOCS_SECTIONS.map((section) => (
            <div key={section.title}>
              <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-secondary-text">
                {section.title}
              </h3>
              <ul className="space-y-1">
                {section.links.map((link) => {
                  const Icon = link.icon;
                  const isActive = pathname === link.href;
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        onClick={() => setSidebarOpen(false)}
                        className={clsx(
                          'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-accent/10 text-accent'
                            : 'text-secondary-text hover:bg-bg-subtle hover:text-primary-text'
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {link.label}
                        {isActive && <ChevronRight className="ml-auto h-4 w-4" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="min-w-0 flex-1 px-4 py-8 md:px-8 lg:px-12">
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>
    </div>
  );
}
