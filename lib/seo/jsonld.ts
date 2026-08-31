/**
 * lib/seo/jsonld.ts
 *
 * Reusable JSON-LD structured data generators for Stellar Intel.
 *
 * The `Dataset` type makes the anchor reputation corpus discoverable and
 * citable by both search engines and AI models.  Per schema.org/Dataset, all
 * fields describe the *underlying data*, not the page rendering it.
 *
 * Honesty rules (issue: "[FEAT][seo] JSON-LD: Dataset for the anchor corpus"):
 *   - The coverage window is always computed from real rows — never hardcoded.
 *   - Sample size is stated plainly.
 *   - When the sample count is below the minimum-sufficient threshold the
 *     description is prefixed with an explicit insufficiency notice so
 *     consumers know the scores are preliminary.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';

/**
 * Minimum total sample count required to consider the reputation corpus
 * statistically sufficient for a 30-day scoring window.
 *
 * Mirrors `MIN_OUTCOMES_THRESHOLD` in lib/reputation/thresholds.ts (env
 * `NEXT_PUBLIC_MIN_OUTCOMES`, default 30).  Kept here separately so
 * lib/seo/ does not import from lib/reputation/ — the SEO layer has no
 * business coupling to the store.
 */
export const JSONLD_MIN_SUFFICIENT_SAMPLES = parseInt(
  process.env.NEXT_PUBLIC_MIN_OUTCOMES ?? '30',
  10
);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DatasetJsonLdOptions {
  /** Canonical page URL injected as `url`. */
  url: string;
  /** Human-readable dataset name. */
  name: string;
  /** Human-readable description of what the dataset contains. */
  description: string;
  /**
   * ISO 8601 date-interval string for `temporalCoverage`,
   * e.g. `"2026-01-01/2026-08-28"`.
   *
   * Pass `null` when there are no recorded rows yet — the field is omitted
   * entirely rather than fabricating an empty or wrong interval.
   */
  temporalCoverage: string | null;
  /**
   * Total number of outcome records in the corpus across all anchors.
   * Emitted as-is; a zero value with null temporalCoverage signals an
   * empty corpus rather than hiding it.
   */
  totalSamples: number;
  /**
   * How often the underlying data is refreshed, expressed as a plain-
   * language string (schema.org does not enumerate these).
   * Example: `"PT5M"` (every 5 minutes).
   */
  updateFrequency: string;
  /** License URI. */
  license: string;
  /** ISO 8601 timestamp when this markup was generated (`dateModified`). */
  dateModified: string;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Builds a schema.org `Dataset` JSON-LD object for the anchor reputation
 * corpus.
 *
 * When `totalSamples` is below `JSONLD_MIN_SUFFICIENT_SAMPLES` the
 * description is prefixed with an explicit insufficiency notice so the
 * markup is never misleading about a thin corpus.
 */
export function buildDatasetJsonLd(options: DatasetJsonLdOptions): Record<string, unknown> {
  const {
    url,
    name,
    description,
    temporalCoverage,
    totalSamples,
    updateFrequency,
    license,
    dateModified,
  } = options;

  const hasSufficientSamples = totalSamples >= JSONLD_MIN_SUFFICIENT_SAMPLES;

  // Prepend a clear insufficiency notice when the corpus is too small for
  // reliable scoring.  This satisfies the requirement to never fabricate or
  // hide small sample sizes.
  const fullDescription = hasSufficientSamples
    ? description
    : `[Preliminary — ${totalSamples} sample${totalSamples === 1 ? '' : 's'} recorded across all anchors; ${JSONLD_MIN_SUFFICIENT_SAMPLES} required for statistically reliable scoring] ${description}`;

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name,
    description: fullDescription,
    url,
    license,
    dateModified,
    creator: {
      '@type': 'Organization',
      name: 'Stellar Intel',
      url: SITE_URL,
    },
    // Live JSON feed is the primary distribution channel.
    distribution: [
      {
        '@type': 'DataDownload',
        encodingFormat: 'application/json',
        contentUrl: `${SITE_URL}/api/reputation/leaderboard`,
        description:
          'Live JSON feed of per-anchor composite reputation scores, fill rates, slippage, and settlement times.',
      },
    ],
    // State the scoring method so consumers know what the numbers mean.
    measurementTechnique:
      'Composite score = 0.4 × fill_rate + 0.3 × (1 − slippage_p50 / 0.05) + 0.3 × (1 − settle_p50 / 300). Computed over a rolling 30-day window of on-chain settled transactions. See https://stellar-intel.vercel.app/methodology.',
    variableMeasured: [
      'fill rate',
      'settlement time (p50, seconds)',
      'slippage (p50, decimal fraction)',
      'composite reputation score',
    ],
    isAccessibleForFree: true,
    updateFrequency,
    keywords: [
      'Stellar',
      'anchor',
      'reputation',
      'SEP-24',
      'SEP-38',
      'SEP-6',
      'off-ramp',
      'fill rate',
      'settlement time',
      'slippage',
    ],
  };

  // `temporalCoverage` is only emitted when real rows exist — an empty or
  // fabricated date interval is worse than omitting the field.
  if (temporalCoverage !== null) {
    jsonLd.temporalCoverage = temporalCoverage;
  }

  return jsonLd;
}

// ─── Serialisation ────────────────────────────────────────────────────────────

/**
 * Serialises a JSON-LD object to a string safe for injection into a
 * `<script type="application/ld+json">` tag.
 *
 * The `<` → `\u003c` replacement prevents script-injection via embedded
 * close-tags (same guard used across the rest of the codebase).
 */
export function serializeJsonLd(jsonLd: Record<string, unknown>): string {
  return JSON.stringify(jsonLd).replace(/</g, '\\u003c');
}
