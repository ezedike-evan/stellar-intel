import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { marked } from 'marked';
import { PROSE_CLASSES } from '@/lib/prose';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';
const TITLE = 'Methodology — Stellar Intel';
const DESCRIPTION =
  'Understand how Stellar Intel evaluates anchor reputation, corridor performance, and recent outcomes.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: new URL('/methodology', SITE_URL).toString(),
    images: [
      {
        url: new URL('/opengraph-image', SITE_URL).toString(),
        width: 1200,
        height: 630,
        alt: 'Stellar Intel — The execution layer for stablecoin off-ramps',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

// Renders docs/ANCHOR_REPUTATION.md directly rather than duplicating its
// content in this component, so the doc stays the single source of truth —
// editing it is the only way to update this page.
function renderMethodologyDoc(): string {
  const source = readFileSync(join(process.cwd(), 'docs/ANCHOR_REPUTATION.md'), 'utf-8');
  return marked.parse(source, { async: false });
}

// Shared with /terms so both markdown-rendered pages look identical.

export default function MethodologyPage() {
  const html = renderMethodologyDoc();

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className={PROSE_CLASSES} dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
