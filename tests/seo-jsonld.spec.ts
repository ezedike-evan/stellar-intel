/**
 * tests/seo-jsonld.spec.ts
 *
 * Unit tests for lib/seo/jsonld.ts.
 *
 * Validates that:
 *   - The generated JSON-LD conforms to the schema.org Dataset shape.
 *   - The insufficiency notice is emitted when totalSamples < threshold.
 *   - temporalCoverage is omitted when null.
 *   - serializeJsonLd escapes < to prevent script-injection.
 */

import { describe, expect, it } from 'vitest';
import {
  buildDatasetJsonLd,
  serializeJsonLd,
  JSONLD_MIN_SUFFICIENT_SAMPLES,
  type DatasetJsonLdOptions,
} from '@/lib/seo/jsonld';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SUFFICIENT_OPTS: DatasetJsonLdOptions = {
  url: 'https://example.com/anchors/standings',
  name: 'Test Dataset',
  description: 'A test dataset.',
  temporalCoverage: '2026-01-01/2026-08-28',
  totalSamples: JSONLD_MIN_SUFFICIENT_SAMPLES,
  updateFrequency: 'PT5M',
  license: 'https://creativecommons.org/licenses/by/4.0/',
  dateModified: '2026-08-28T00:00:00.000Z',
};

// ─── Schema shape ─────────────────────────────────────────────────────────────

describe('buildDatasetJsonLd — schema shape', () => {
  it('emits the required @context and @type', () => {
    const jsonLd = buildDatasetJsonLd(SUFFICIENT_OPTS);
    expect(jsonLd['@context']).toBe('https://schema.org');
    expect(jsonLd['@type']).toBe('Dataset');
  });

  it('includes name, url, license, and dateModified', () => {
    const jsonLd = buildDatasetJsonLd(SUFFICIENT_OPTS);
    expect(jsonLd.name).toBe(SUFFICIENT_OPTS.name);
    expect(jsonLd.url).toBe(SUFFICIENT_OPTS.url);
    expect(jsonLd.license).toBe(SUFFICIENT_OPTS.license);
    expect(jsonLd.dateModified).toBe(SUFFICIENT_OPTS.dateModified);
  });

  it('includes a distribution array with at least one entry', () => {
    const jsonLd = buildDatasetJsonLd(SUFFICIENT_OPTS);
    expect(Array.isArray(jsonLd.distribution)).toBe(true);
    const dist = jsonLd.distribution as unknown[];
    expect(dist.length).toBeGreaterThan(0);
    const first = dist[0] as Record<string, unknown>;
    expect(first['@type']).toBe('DataDownload');
    expect(typeof first.contentUrl).toBe('string');
  });

  it('includes updateFrequency', () => {
    const jsonLd = buildDatasetJsonLd(SUFFICIENT_OPTS);
    expect(jsonLd.updateFrequency).toBe('PT5M');
  });

  it('includes measurementTechnique describing the composite formula', () => {
    const jsonLd = buildDatasetJsonLd(SUFFICIENT_OPTS);
    expect(typeof jsonLd.measurementTechnique).toBe('string');
    expect((jsonLd.measurementTechnique as string).length).toBeGreaterThan(0);
  });

  it('includes variableMeasured with at least 3 entries', () => {
    const jsonLd = buildDatasetJsonLd(SUFFICIENT_OPTS);
    expect(Array.isArray(jsonLd.variableMeasured)).toBe(true);
    expect((jsonLd.variableMeasured as unknown[]).length).toBeGreaterThanOrEqual(3);
  });
});

// ─── temporalCoverage ─────────────────────────────────────────────────────────

describe('buildDatasetJsonLd — temporalCoverage', () => {
  it('includes temporalCoverage when provided', () => {
    const jsonLd = buildDatasetJsonLd(SUFFICIENT_OPTS);
    expect(jsonLd.temporalCoverage).toBe('2026-01-01/2026-08-28');
  });

  it('omits temporalCoverage when null (no data yet)', () => {
    const jsonLd = buildDatasetJsonLd({ ...SUFFICIENT_OPTS, temporalCoverage: null });
    expect('temporalCoverage' in jsonLd).toBe(false);
  });
});

// ─── Insufficiency notice ─────────────────────────────────────────────────────

describe('buildDatasetJsonLd — insufficiency notice', () => {
  it('does NOT prefix the description when samples meet the threshold', () => {
    const jsonLd = buildDatasetJsonLd(SUFFICIENT_OPTS);
    expect(jsonLd.description).toBe(SUFFICIENT_OPTS.description);
  });

  it('prefixes the description with an insufficiency notice when samples < threshold', () => {
    const jsonLd = buildDatasetJsonLd({
      ...SUFFICIENT_OPTS,
      totalSamples: JSONLD_MIN_SUFFICIENT_SAMPLES - 1,
    });
    const desc = jsonLd.description as string;
    expect(desc.startsWith('[Preliminary')).toBe(true);
    expect(desc).toContain(String(JSONLD_MIN_SUFFICIENT_SAMPLES - 1));
    expect(desc).toContain(SUFFICIENT_OPTS.description);
  });

  it('uses singular "sample" when totalSamples is 1', () => {
    const jsonLd = buildDatasetJsonLd({ ...SUFFICIENT_OPTS, totalSamples: 1 });
    const desc = jsonLd.description as string;
    expect(desc).toContain('1 sample recorded');
    expect(desc).not.toContain('1 samples');
  });

  it('does NOT add the notice when totalSamples equals the threshold exactly', () => {
    const jsonLd = buildDatasetJsonLd({
      ...SUFFICIENT_OPTS,
      totalSamples: JSONLD_MIN_SUFFICIENT_SAMPLES,
    });
    expect((jsonLd.description as string).startsWith('[Preliminary')).toBe(false);
  });

  it('adds the notice when totalSamples is 0', () => {
    const jsonLd = buildDatasetJsonLd({
      ...SUFFICIENT_OPTS,
      totalSamples: 0,
      temporalCoverage: null,
    });
    expect((jsonLd.description as string).startsWith('[Preliminary')).toBe(true);
  });
});

// ─── serializeJsonLd ──────────────────────────────────────────────────────────

describe('serializeJsonLd', () => {
  it('returns valid JSON', () => {
    const jsonLd = buildDatasetJsonLd(SUFFICIENT_OPTS);
    expect(() => JSON.parse(serializeJsonLd(jsonLd))).not.toThrow();
  });

  it('escapes < to \\u003c to prevent script-tag injection', () => {
    const jsonLd = buildDatasetJsonLd({
      ...SUFFICIENT_OPTS,
      description: 'A <script>alert(1)</script> injection.',
    });
    const serialized = serializeJsonLd(jsonLd);
    expect(serialized).not.toContain('<script>');
    expect(serialized).toContain('\\u003c');
  });
});
