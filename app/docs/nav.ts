/**
 * The single source of truth for which pages exist under /docs (#871).
 *
 * There were two independent lists — a sidebar in `layout.tsx` and a card grid
 * on `page.tsx` — so adding a route meant editing both, and forgetting one left
 * a page reachable from only half the site with nothing to catch it. They now
 * derive from here, and `tests/docs-nav.spec.ts` asserts they stay in step.
 *
 * Card-specific presentation (description, icon colour) stays on the card,
 * keyed by href, because it is genuinely per-card and would be noise in a
 * sidebar entry.
 */

import { BookOpen, Shield, Code, Zap, Puzzle, Globe } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface DocsRoute {
  href: string;
  /** Sidebar label. Cards may use a longer title. */
  label: string;
  icon: LucideIcon;
}

export interface DocsSection {
  title: string;
  links: DocsRoute[];
}

export const DOCS_SECTIONS: DocsSection[] = [
  {
    title: 'Getting Started',
    links: [
      { href: '/docs', label: 'Overview', icon: BookOpen },
      { href: '/docs/quickstart', label: 'Quickstart', icon: Zap },
    ],
  },
  {
    title: 'API Reference',
    links: [
      { href: '/docs/api', label: 'Interactive API', icon: Globe },
      { href: '/docs/auth', label: 'Auth & Rate Limits', icon: Shield },
    ],
  },
  {
    title: 'Integration Guides',
    links: [
      { href: '/docs/webhooks', label: 'Webhooks', icon: Puzzle },
      { href: '/docs/sdks', label: 'SDKs & Libraries', icon: Code },
      { href: '/docs/mcp', label: 'MCP Tool Docs', icon: Code },
    ],
  },
];

/** Every route in the sidebar, flattened. */
export const DOCS_ROUTES: DocsRoute[] = DOCS_SECTIONS.flatMap((s) => s.links);

/**
 * Routes the index page shows as cards.
 *
 * `/docs` is excluded — the overview does not link to itself.
 */
export const DOCS_CARD_ROUTES: DocsRoute[] = DOCS_ROUTES.filter((r) => r.href !== '/docs');
