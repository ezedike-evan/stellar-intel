import { marked } from 'marked';
import type { Metadata } from 'next';
import { PROSE_CLASSES } from '@/lib/prose';
import { buildFaqPageJsonLd, parseFaqMarkdown, serializeJsonLd } from '@/lib/seo/jsonld';
import { readFaqMarkdown } from '@/lib/seo/faq-source';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';
const TITLE = 'FAQ — Stellar Intel';
const DESCRIPTION =
  'Answers about custody, anchors, corridors, the MCP agent surface, and how to contribute.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: new URL('/faq', SITE_URL).toString(),
    images: [
      {
        url: new URL('/opengraph-image', SITE_URL).toString(),
        width: 1200,
        height: 630,
        alt: 'Stellar Intel — a public health record for Stellar off-ramp anchors',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

function loadFaqSource(): string {
  return readFaqMarkdown();
}

export default function FaqPage() {
  const source = loadFaqSource();
  const html = marked.parse(source, { async: false });
  const jsonLd = serializeJsonLd(buildFaqPageJsonLd(parseFaqMarkdown(source)));

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <div
        className={PROSE_CLASSES}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </main>
  );
}
