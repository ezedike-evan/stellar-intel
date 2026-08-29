import type { Metadata } from 'next';
import DocsLayoutClient from './layout-client';

/**
 * Docs-level metadata default (#1057).
 *
 * Every child page should override `title` and `description` with its own
 * `export const metadata`.  This object is the fallback so that a new page
 * inherits something sensible rather than the site-wide title.
 */
export const metadata: Metadata = {
  title: {
    default: 'Developer Docs — Stellar Intel',
    template: '%s — Stellar Intel Docs',
  },
  description:
    'Integrate Stellar Intel into your wallet, agent, or application. Browse the API reference, authentication guide, SDK docs, webhook design, and MCP server documentation.',
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <DocsLayoutClient>{children}</DocsLayoutClient>;
}
