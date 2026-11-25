import type { Metadata } from 'next';
import Link from 'next/link';
import { RefundsPanel } from '@/components/history/RefundsPanel';
import { flags } from '@/lib/flags';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';
const TITLE = 'Transaction history — Stellar Intel';
const DESCRIPTION = 'Your Stellar off-ramp transaction history through Stellar Intel.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: new URL('/history', SITE_URL).toString(),
    images: [
      {
        url: new URL('/opengraph-image', SITE_URL).toString(),
        width: 1200,
        height: 630,
        alt: TITLE,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function HistoryPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-primary-text">Transaction history</h1>
      {flags.refundGuarantees && (
        <section aria-labelledby="refunds-heading" className="mt-8">
          <h2 id="refunds-heading" className="mb-3 text-lg font-semibold text-primary-text">
            Refunds
          </h2>
          <RefundsPanel />
        </section>
      )}
      <p className="mt-3 text-sm text-fg-muted">
        Coming soon. Once available, this page will list every off-ramp you&apos;ve completed
        through Stellar Intel.
      </p>
      <Link
        href="/offramp"
        className="mt-6 inline-block text-sm font-medium text-accent hover:underline dark:text-accent"
      >
        Back to off-ramp
      </Link>
    </div>
  );
}
