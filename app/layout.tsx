import type { Metadata } from 'next';
import './globals.css';
import { inter } from './fonts';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { ThemeProvider } from '@/contexts/theme';
import { BottomNav } from '@/components/layout/BottomNav';
import { OfflineBar } from '@/components/layout/OfflineBar';
import { TestnetBanner } from '@/components/layout/TestnetBanner';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ToastPortal } from '@/components/ui/Toast';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';
const SITE_NAME = 'Stellar Intel';
const SITE_TITLE = 'Stellar Intel — The execution layer for stablecoin off-ramps';
const SITE_DESCRIPTION =
  'Compare live SEP-38 quotes across every Stellar anchor, then settle a non-custodial USDC off-ramp to Nigeria, Kenya, Ghana, Mexico, and more — in a single signed intent.';

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
        <script defer data-domain="stellar-intel.vercel.app" src="https://plausible.io/js/script.js"></script>
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
        className={`${inter.variable} ${inter.className} flex min-h-screen flex-col bg-background`}
      >
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-black"
        >
          Skip to content
        </a>
        <ThemeProvider>
          <WalletProvider>
            <ToastProvider>
              <TestnetBanner />
              <OfflineBar />
              <Header />
              <main id="main-content" className="mx-auto max-w-7xl px-4 py-8">
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
