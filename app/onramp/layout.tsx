import type { Metadata } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';
const TITLE = 'Stellar on-ramp estimates — Stellar Intel';
const DESCRIPTION =
  'Compare deposit estimates across Stellar anchors and deposit straight to your own wallet.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: new URL('/onramp', SITE_URL).toString(),
    images: [
      {
        url: new URL('/onramp/opengraph-image', SITE_URL).toString(),
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

export default function OnrampLayout({ children }: { children: React.ReactNode }) {
  return children;
}
