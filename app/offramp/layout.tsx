import type { Metadata } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';
const TITLE = 'USDC off-ramp rates — Stellar Intel';
const DESCRIPTION =
  'Compare live USDC withdrawal rates across Stellar anchors and execute directly with a non-custodial wallet.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: new URL('/offramp', SITE_URL).toString(),
    images: [
      {
        url: new URL('/offramp/opengraph-image', SITE_URL).toString(),
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

export default function OfframpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
