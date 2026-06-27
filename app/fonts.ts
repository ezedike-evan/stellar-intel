import { Inter } from 'next/font/google';

// Self-hosted via next/font (B090 / #523).
//
// - `display: 'swap'` renders text immediately in the fallback and swaps in
//   Inter when ready, eliminating FOIT (flash of invisible text).
// - Inter is a variable font, so the single latin-subset file covers all
//   weights; `preload: true` preloads only that primary subset.
// - `adjustFontFallback` size-matches the system fallback to Inter, minimising
//   layout shift (CLS) during the swap.
export const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
  variable: '--font-inter',
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
  adjustFontFallback: true,
});
