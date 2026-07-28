import type { Metadata } from 'next';

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

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <h1 className="text-3xl font-semibold text-gray-900 dark:text-white">Terms</h1>
      <p className="text-base text-gray-600 dark:text-gray-300">
        By using Stellar Intel, you agree to use the site and its information responsibly and at
        your own risk.
      </p>
    </main>
  );
}
