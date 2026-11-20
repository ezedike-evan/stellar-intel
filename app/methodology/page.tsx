import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { marked } from 'marked';
import { PROSE_CLASSES } from '@/lib/prose';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';
const TITLE = 'Methodology — Stellar Intel';
const DESCRIPTION =
  'Understand how Stellar Intel evaluates anchor reputation, corridor performance, and recent outcomes.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: new URL('/methodology', SITE_URL).toString(),
    images: [
      {
        url: new URL('/opengraph-image', SITE_URL).toString(),
        width: 1200,
        height: 630,
        alt: 'Stellar Intel — a public health record for Stellar off-ramp anchors',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

// Renders docs/ANCHOR_REPUTATION.md directly rather than duplicating its
// content in this component, so the doc stays the single source of truth —
// editing it is the only way to update this page.
function renderMethodologyDoc(): string {
  const source = readFileSync(join(process.cwd(), 'docs/ANCHOR_REPUTATION.md'), 'utf-8');
  return marked.parse(source, { async: false });
}

// Shared with /terms so both markdown-rendered pages look identical.
export default function MethodologyPage() {
  const html = renderMethodologyDoc();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className={PROSE_CLASSES} dangerouslySetInnerHTML={{ __html: html }} />
      <section aria-labelledby="quotes-estimates-heading" className={PROSE_CLASSES}>
        <h2 id="quotes-estimates-heading">Quotes, estimates and what actually lands</h2>
        <p>
          A <strong>firm</strong> quote comes from an anchor&apos;s SEP-38 quote server and is
          binding until it expires. An <strong>indicative</strong> estimate is computed by Stellar
          Intel from the anchor&apos;s published fees and a reference price, and is never a promise.
          Every estimate is labelled with which of the two it is.
        </p>
        <p>
          The reference price answers &ldquo;what is one unit of this asset worth in the local
          currency&rdquo;. USDC is treated as exactly 1 USD and converted with the open.er-api
          USD&rarr;fiat rate. A fiat-pegged asset (for example NGNC&rarr;NGN) uses the open.er-api
          rate between its peg and the local currency. Any other asset uses the midpoint of the best
          bid and ask on the SDEX order book against USDC, then the same USD&rarr;fiat rate. If a
          side of the book is empty or the spread is wider than 5%, no price is shown rather than a
          bad one.
        </p>
        <p>
          What actually landed is measured from the anchor&apos;s own transaction record as{' '}
          <code>amount_out / amount_in</code> (fees included). A second figure,{' '}
          <code>amount_out / (amount_in &minus; amount_fee)</code>, strips the fee out when the
          anchor reports it.
        </p>
        <p>
          Before the wallet is asked to sign a withdrawal, the anchor&apos;s own{' '}
          <code>amount_out</code> estimate is compared with a minimum-receive floor. The floor is
          the selected rate&apos;s expected net amount less <code>MIN_RECEIVE_TOLERANCE</code>,
          which is 2%. If the anchor now estimates less than the floor, the payment is blocked and
          the user is told both figures. If the anchor gives no estimate, the flow continues and the
          final amount is set by the anchor.
        </p>
      </section>
    </div>
  );
}
