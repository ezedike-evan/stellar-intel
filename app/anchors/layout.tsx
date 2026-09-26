import type { Metadata } from 'next';
import { AnchorsBreadcrumbs } from '@/components/seo/AnchorsBreadcrumbs';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';
const TITLE = 'Anchor directory — Stellar Intel';
const DESCRIPTION =
  'Every registered Stellar off-ramp anchor, what it declares about itself, and how it has actually performed on the corridors it is registered for.';

// app/anchors/page.tsx is a client component ('use client', for the corridor
// query-param filter), so metadata has to live here — a page.tsx cannot
// export it once it opts into client rendering.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: new URL('/anchors', SITE_URL).toString(),
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

export default function AnchorsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AnchorsBreadcrumbs />
      {children}
    </>
  );
}
