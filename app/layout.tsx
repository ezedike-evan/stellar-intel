import type { Metadata } from 'next';
import './globals.css';
import { archivo, splineSansMono } from './fonts';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { ThemeProvider } from '@/contexts/theme';
import { BottomNav } from '@/components/layout/BottomNav';
import { OfflineBar } from '@/components/layout/OfflineBar';
import { TestnetBanner } from '@/components/layout/TestnetBanner';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ToastPortal } from '@/components/ui/Toast';
import { getRootJsonLd, serializeJsonLd } from '@/lib/seo/jsonld';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';
const SITE_NAME = 'Stellar Intel';
// docs/POSITIONING.md retires "the execution layer for stablecoin value on
// Stellar" by name, along with the claim of live SEP-38 quotes across every
// integrated anchor. Both survived here and in the OG card, which is the one
// place a stale claim travels furthest. The title now leads with the half that
// works without anyone's cooperation.
const SITE_TITLE = 'Stellar Intel — a public health record for Stellar off-ramp anchors';
const SITE_DESCRIPTION =
  'Every registered Stellar off-ramp anchor, probed every five minutes across four signals — uptime, quote availability, issuer mismatch, TOML integrity — with the scoring method published and small samples labelled as small.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // og:image / twitter:image are supplied by app/opengraph-image.tsx.
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    url: SITE_URL,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  alternates: {
    canonical: '/',
  },
  icons: {
    icon: [
      // SVG favicon — theme-adaptive (light/dark via prefers-color-scheme).
      // Modern browsers (Chrome 80+, Firefox 41+, Safari 12+) prefer this
      // over raster favicons when listed first.
      { url: '/favicon.svg', type: 'image/svg+xml' },
      // Raster fallbacks for older browsers / OS favicon caches.
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicons/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicons/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/favicons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/favicons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(getRootJsonLd(SITE_URL)),
          }}
        />
        {process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN && (
          <script
            defer
            data-domain={process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN}
            src="https://plausible.io/js/script.js"
          />
        )}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var stored = null;
                try {
                  stored = localStorage.getItem('theme');
                } catch(e) {}
                try {
                  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  if (stored === 'dark' || (!stored && prefersDark)) {
                    document.documentElement.classList.add('dark');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${archivo.variable} ${splineSansMono.variable} ${archivo.className} flex min-h-screen flex-col bg-background text-primary-text`}
      >
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded focus:border-control-border focus:bg-bg-subtle focus:text-primary-text focus:border focus:px-4 focus:py-2"
        >
          Skip to content
        </a>
        <ThemeProvider>
          <WalletProvider>
            <ToastProvider>
              <TestnetBanner />
              <OfflineBar />
              <Header />
              {/* `min-w-0` is load-bearing. <main> is a flex item of the body
                  column, and a flex item defaults to `min-width: auto`, so it
                  refuses to shrink below the intrinsic width of its widest
                  child. Any wide table then pushes the whole page sideways at
                  390px and no `overflow-x-auto` inside can contain it, because
                  the scroll container itself is being stretched. */}
              <main id="main-content" className="mx-auto w-full max-w-7xl min-w-0 px-4 py-8">
                {children}
              </main>
              <Footer />
              <BottomNav />
              <ToastPortal />
            </ToastProvider>
          </WalletProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
