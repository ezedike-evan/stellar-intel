import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DOCS_SECTIONS, DOCS_ROUTES, DOCS_CARD_ROUTES } from '@/app/docs/nav';

// #871 — the sidebar in app/docs/layout.tsx and the card grid on
// app/docs/page.tsx were two independent hardcoded lists. Adding a route meant
// editing both, and forgetting one left a page reachable from half the site.
// They derive from app/docs/nav.ts now; this keeps that list honest.

describe('docs navigation (#871)', () => {
  it('every listed route has a page on disk', () => {
    for (const route of DOCS_ROUTES) {
      // '/docs' → app/docs/page.tsx, '/docs/api' → app/docs/api/page.tsx
      const segment = route.href.replace(/^\/docs\/?/, '');
      const pagePath = join(process.cwd(), 'app/docs', segment, 'page.tsx');

      expect(
        existsSync(pagePath),
        `${route.href} is in the docs nav but ${pagePath} does not exist`
      ).toBe(true);
    }
  });

  it('every /docs page on disk is reachable from the nav', async () => {
    const { readdirSync } = await import('node:fs');
    const docsDir = join(process.cwd(), 'app/docs');

    const routeDirs = readdirSync(docsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `/docs/${entry.name}`)
      .filter((href) => existsSync(join(docsDir, href.replace('/docs/', ''), 'page.tsx')));

    const linked = new Set(DOCS_ROUTES.map((r) => r.href));

    for (const href of routeDirs) {
      expect(
        linked.has(href),
        `${href} has a page but is not in DOCS_SECTIONS — it would be unreachable from the sidebar`
      ).toBe(true);
    }
  });

  it('has no duplicate hrefs', () => {
    const hrefs = DOCS_ROUTES.map((r) => r.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('excludes the overview from the card grid but keeps it in the sidebar', () => {
    expect(DOCS_ROUTES.some((r) => r.href === '/docs')).toBe(true);
    expect(DOCS_CARD_ROUTES.some((r) => r.href === '/docs')).toBe(false);
    expect(DOCS_CARD_ROUTES).toHaveLength(DOCS_ROUTES.length - 1);
  });

  it('gives every section a title and at least one link', () => {
    for (const section of DOCS_SECTIONS) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.links.length).toBeGreaterThan(0);
    }
  });
});
