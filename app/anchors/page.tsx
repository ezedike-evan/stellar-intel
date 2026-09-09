/**
 * app/anchors/page.tsx
 *
 * Anchor registry page — lists every registered anchor, its scorecard, and
 * the live corridor leaderboard.
 *
 * Previously `'use client'`.  Converted to a React Server Component so that
 * Dataset JSON-LD markup can be injected with a coverage window derived from
 * the real underlying data (requirement: coverage window must be computed from
 * actual data, not hardcoded).
 *
 * The interactive corridor-filter and leaderboard live in AnchorsContent, which
 * is still a client component — the 'use client' boundary is now at the
 * component level rather than the page level.
 */

import { ANCHORS } from '@/constants';
import { AnchorsContent } from '@/components/anchors/AnchorsContent';
import { buildDatasetJsonLd, serializeJsonLd } from '@/lib/seo/jsonld';
import { loadCorpusCoverage } from '@/lib/reputation/coverage';

export const revalidate = 300; // 5 minutes, matching /anchors/standings

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';

export default async function AnchorsPage() {
  // Derive coverage window from real outcome data so the JSON-LD is accurate.
  // loadCorpusCoverage returns null coverage when the store is unavailable
  // (dev / prerender) — the JSON-LD omits temporalCoverage in that case.
  const coverage = await loadCorpusCoverage(ANCHORS.map((a) => a.id));

  const jsonLd = buildDatasetJsonLd({
    url: `${SITE_URL}/anchors`,
    name: 'Stellar Anchor Reputation Corpus — Registry',
    description:
      'Public health and reputation records for Stellar off-ramp anchors registered with Stellar Intel. ' +
      'Includes fill rate, settlement time (p50), and slippage (p50) derived from on-chain settled transactions, ' +
      `covering ${ANCHORS.length} registered anchors across all supported corridors.`,
    temporalCoverage: coverage.temporalCoverage,
    totalSamples: coverage.totalSamples,
    // The probe cycle and leaderboard both refresh every 5 minutes.
    updateFrequency: 'PT5M',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    dateModified: new Date().toISOString(),
  });

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <AnchorsContent />
    </>
  );
}
