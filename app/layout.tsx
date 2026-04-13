import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { ThemeProvider } from '@/contexts/theme';
import { BottomNav } from '@/components/layout/bottomNav';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Stellar Intel — Real-time rate comparison on Stellar',
  description:
    'Compare off-ramp rates, on-ramp fees, yield protocols, and swap routes across the Stellar network in real time.',
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
      <body className={`${inter.className} min-h-screen bg-background`}>
        <ThemeProvider>
          <Navbar />
          <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
          <Footer />
          <BottomNav />
        </ThemeProvider>
      </body>
    </html>
  );
}
