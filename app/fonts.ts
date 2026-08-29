import { Archivo, Spline_Sans_Mono } from 'next/font/google';

// Self-hosted via next/font (B090 / #523).
//
// Two families, no more. Archivo carries the voice; Spline Sans Mono carries
// every piece of machine-produced text on the site — issuer keys, ledger
// sequences, corridor ids, SEP names, scores. A monitoring product renders more
// machine text than prose, and setting that text in the body face is a large
// part of why a record can end up looking like marketing.
//
// Both are OFL and served through next/font, so they are self-hosted at build
// time rather than fetched from Google at runtime.
//
// - `display: 'swap'` renders immediately in the fallback and swaps in, so
//   there is no flash of invisible text.
// - Both are variable: one latin-subset file per family covers every weight,
//   and for Archivo the `wdth` axis as well.
// - `adjustFontFallback` size-matches the system fallback, minimising layout
//   shift during the swap.

/**
 * Display and body.
 *
 * The `wdth` axis is the reason for choosing Archivo. Display type is set
 * expanded — `font-variation-settings: 'wdth' 125`, applied by the `.type-display`
 * and `.type-title` utilities in globals.css — where this category is uniformly
 * condensed or default-width. Body text stays at `wdth` 100.
 */
export const archivo = Archivo({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
  variable: '--font-archivo',
  axes: ['wdth'],
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
  adjustFontFallback: true,
});

/**
 * Mono. Deliberately not JetBrains Mono, which is the default of most
 * developer-tooling sites in this category.
 */
export const splineSansMono = Spline_Sans_Mono({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
  variable: '--font-mono',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
  adjustFontFallback: true,
});
