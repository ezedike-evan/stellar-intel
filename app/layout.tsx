import type { Metadata } from 'next';
import './globals.css';
import { inter } from './fonts';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { ThemeProvider } from '@/contexts/theme';
import { BottomNav } from '@/components/layout/BottomNav';
import { OfflineBar } from '@/components/layout/OfflineBar';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ToastPortal } from '@/components/ui/Toast';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';
const SITE_NAME = 'Stellar Intel';
const SITE_TITLE = 'Stellar Intel — Real-time rate comparison on Stellar';
const SITE_DESCRIPTION =
  'Compare off-ramp rates, on-ramp fees, yield protocols, and swap routes across the Stellar network in real time.';

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
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var stored = localStorage.getItem('theme');
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
        <ThemeProvider>
          <WalletProvider>
            <ToastProvider>
              <OfflineBar />
              <Header />
              <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
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
