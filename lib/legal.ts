/**
 * lib/legal.ts
 *
 * User-facing legal copy, in one place (#739).
 *
 * The banner and the Terms page previously carried their own strings, so they
 * could drift apart — and a disclaimer that contradicts the terms it summarises
 * is worse than either alone. `docs/TERMS_OF_SERVICE.md` is the canonical
 * wording; this mirrors it for rendering, and the doc says so.
 */

/**
 * The short-form disclaimer, as three sentences.
 *
 * An array rather than one string so a renderer can lay the sentences out
 * without splitting prose on '.', which breaks on abbreviations.
 */
export const DISCLAIMER_SENTENCES = [
  'Stellar Intel is non-custodial.',
  'You sign every transaction with your own wallet.',
  'Rates are live quotes, not guarantees.',
] as const;

/** The same disclaimer as a single paragraph. */
export const DISCLAIMER_TEXT = DISCLAIMER_SENTENCES.join(' ');

/** Route of the full Terms page. */
export const TERMS_HREF = '/terms';
