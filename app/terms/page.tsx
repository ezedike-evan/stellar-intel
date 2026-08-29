import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { marked } from 'marked';
import { PROSE_CLASSES } from '@/lib/prose';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';
const TITLE = 'Terms — Stellar Intel';
const DESCRIPTION =
  'Review the terms of service for using Stellar Intel and its public data and tools.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: new URL('/terms', SITE_URL).toString(),
    images: [
      {
        url: new URL('/opengraph-image', SITE_URL).toString(),
        width: 1200,
        height: 630,
        alt: 'Stellar Intel — Real-time rate comparison on Stellar',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

// Renders docs/TERMS_OF_SERVICE.md directly rather than duplicating it here, so
// the document stays the single source — the same pattern /methodology uses.
// The page previously carried two sentences of its own prose, which is how a
// page and the document it is supposed to reflect drift apart (#738).
function renderTermsDoc(): string {
  const source = readFileSync(join(process.cwd(), 'docs/TERMS_OF_SERVICE.md'), 'utf-8');
  return marked.parse(source, { async: false });
}

export default function TermsPage() {
  const html = renderTermsDoc();

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className={PROSE_CLASSES} dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
