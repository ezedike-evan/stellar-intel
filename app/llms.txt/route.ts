import { ANCHOR_COUNT_WORD } from '@/constants/anchors';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';

// The short orientation file a model fetches to learn what this site is and
// where the authoritative pages are — see https://llmstxt.org. Content stays
// hand-written rather than generated from docs/POSITIONING.md and
// docs/ANCHOR_REPUTATION.md so it can say the same thing in far fewer words;
// keep the two in sync by hand if either changes.
function buildLlmsTxt(): string {
  return `# Stellar Intel

> A public health record for Stellar off-ramp anchors: what an anchor says about itself, checked against what it actually did.

Stellar Intel probes ${ANCHOR_COUNT_WORD} registered SEP off-ramp anchors on Stellar every five minutes across four signals — uptime, quote availability, issuer mismatch, and TOML integrity — and aggregates settlement outcomes (fill rate, slippage, settlement time) into public reputation scorecards over 7-, 30-, and 90-day windows. A non-custodial execution path (quote, prepare, sign, submit) sits on top of that record: Stellar Intel never holds a private key or takes custody of funds, and every payment leg is signed by the user's or agent's own wallet.

## What the data is not

Not every registered anchor currently publishes a firm SEP-38 quote, so live cross-anchor rate comparison is not yet possible for the whole fleet — see the Methodology page for which anchors quote and which don't. A scorecard window with too few outcomes is labelled \`insufficient_data\` rather than smoothed into a number; a newly registered anchor starts there, not at a score. Coverage is limited to the 7-, 30-, and 90-day windows above — there is no longer history than that.

## Docs

- [Developer Portal](${SITE_URL}/docs): quickstart, authentication, SDKs, and webhooks.
- [API Reference](${SITE_URL}/docs/api): REST endpoints and request/response shapes (OpenAPI spec at ${SITE_URL}/openapi.json).
- [MCP server](${SITE_URL}/docs/mcp): \`intel.offramp.quote\`, \`intel.offramp.prepare\`, \`intel.execute\` — install via \`npm install @stellarintel/mcp\`.
- [Methodology](${SITE_URL}/methodology): how the composite reputation score is computed, and per-anchor SEP support.
`;
}

export async function GET(): Promise<Response> {
  return new Response(buildLlmsTxt(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
