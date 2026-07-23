import type { Metadata } from 'next';

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

export default function MethodologyPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <h1 className="text-3xl font-semibold text-gray-900 dark:text-white">Methodology</h1>
      <p className="text-base text-gray-600 dark:text-gray-300">
        Stellar Intel evaluates anchors by combining corridor coverage, recent outcome history,
        and reputation signals to help users compare off-ramp options.
      </p>
    </main>
  );
}
