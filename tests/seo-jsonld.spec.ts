/**
 * tests/seo-jsonld.spec.ts
 *
 * Unit tests for lib/seo/jsonld.ts.
 *
 * Validates that:
 *   - The generated JSON-LD conforms to the schema.org Dataset shape.
 *   - The insufficiency notice is emitted when totalSamples < threshold.
 *   - temporalCoverage is omitted when null.
 *   - FAQPage JSON-LD is generated from docs/FAQ.md (#1061).
 *   - serializeJsonLd escapes < to prevent script-injection.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildDatasetJsonLd,
  serializeJsonLd,
  getOrganizationJsonLd,
  getWebSiteJsonLd,
  getRootJsonLd,
  JSONLD_MIN_SUFFICIENT_SAMPLES,
  type DatasetJsonLdOptions,
  FaqJsonLdError,
  parseFaqMarkdown,
  readFaqMarkdown,
  buildFaqPageJsonLd,
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

const FAQ_PATH = join(process.cwd(), 'docs/FAQ.md');
const FAQ_SOURCE = readFileSync(FAQ_PATH, 'utf-8');

function headingsFrom(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => line.startsWith('### '))
    .map((line) => line.slice(4).trim());
}

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

describe('parseFaqMarkdown (#1061)', () => {
  it('extracts every ### heading from docs/FAQ.md as a question', () => {
    const entries = parseFaqMarkdown(FAQ_SOURCE);
    const headings = headingsFrom(FAQ_SOURCE);

    expect(headings.length).toBeGreaterThan(0);
    expect(entries.map((entry) => entry.question)).toEqual(headings);
  });

  it('keeps non-empty answers for every real FAQ item', () => {
    for (const entry of parseFaqMarkdown(FAQ_SOURCE)) {
      expect(entry.answer.length).toBeGreaterThan(0);
    }
  });

  it('strips markdown links, bold, and backticks from JSON-LD text', () => {
    const source = [
      '### Is [`docs/NON_CUSTODY.md`](NON_CUSTODY.md) the source?',
      '',
      'See **before** you choose. Call the `HTTP API`.',
    ].join('\n');

    const [entry] = parseFaqMarkdown(source);
    expect(entry?.question).toBe('Is docs/NON_CUSTODY.md the source?');
    expect(entry?.answer).toBe('See before you choose. Call the HTTP API.');
  });

  it('throws FaqJsonLdError when there are no questions', () => {
    expect(() => parseFaqMarkdown('# FAQ\n\nNo questions here.\n')).toThrow(FaqJsonLdError);
  });

  it('throws FaqJsonLdError when a question has no answer', () => {
    expect(() => parseFaqMarkdown('### Orphan question?\n')).toThrow(FaqJsonLdError);
  });

  it('throws FaqJsonLdError when a question exceeds 300 characters', () => {
    const question = 'Q'.repeat(301);
    expect(() => parseFaqMarkdown(`### ${question}\n\nA short answer.\n`)).toThrow(FaqJsonLdError);
  });

  it('throws FaqJsonLdError when an answer exceeds 8000 characters', () => {
    const answer = 'A'.repeat(8001);
    expect(() => parseFaqMarkdown(`### Short question?\n\n${answer}\n`)).toThrow(FaqJsonLdError);
  });

  it('throws FaqJsonLdError when there are more than 50 questions', () => {
    const body = Array.from({ length: 51 }, (_, i) => `### Q${i}?\n\nA${i}.\n`).join('\n');
    expect(() => parseFaqMarkdown(body)).toThrow(FaqJsonLdError);
  });
});

describe('readFaqMarkdown (#1061)', () => {
  it('reads docs/FAQ.md from the repo root', () => {
    expect(readFaqMarkdown()).toContain('### Is this custodial?');
  });

  it('throws FaqJsonLdError when the file is missing', () => {
    expect(() => readFaqMarkdown('docs/FAQ-does-not-exist.md')).toThrow(FaqJsonLdError);
  });
});

describe('buildFaqPageJsonLd (#1061)', () => {
  it('emits schema.org FAQPage / Question / Answer from docs/FAQ.md', () => {
    const graph = buildFaqPageJsonLd(parseFaqMarkdown(FAQ_SOURCE));
    const headings = headingsFrom(FAQ_SOURCE);

    expect(graph['@context']).toBe('https://schema.org');
    expect(graph['@type']).toBe('FAQPage');
    expect(graph.mainEntity).toHaveLength(headings.length);

    for (const [i, heading] of headings.entries()) {
      const entity = graph.mainEntity[i];
      expect(entity?.['@type']).toBe('Question');
      expect(entity?.name).toBe(heading);
      expect(entity?.acceptedAnswer['@type']).toBe('Answer');
      expect(entity?.acceptedAnswer.text.length).toBeGreaterThan(0);
    }
  });

  it('throws FaqJsonLdError when given no entries', () => {
    expect(() => buildFaqPageJsonLd([])).toThrow(FaqJsonLdError);
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

  it('escapes < so the payload cannot break out of a script tag', () => {
    const payload = serializeJsonLd({ text: '<script>alert(1)</script>' });
    expect(payload).not.toContain('<');
    expect(payload).toContain('\\u003c');
    expect(JSON.parse(payload)).toEqual({ text: '<script>alert(1)</script>' });
  });
});

// ─── Organization & WebSite JSON-LD ──────────────────────────────────────────

describe('getOrganizationJsonLd', () => {
  it('emits schema.org Organization with correct name, logo, and sameAs links', () => {
    const org = getOrganizationJsonLd('https://stellar-intel.vercel.app');
    expect(org['@context']).toBe('https://schema.org');
    expect(org['@type']).toBe('Organization');
    expect(org.name).toBe('Stellar Intel');
    expect(org.url).toBe('https://stellar-intel.vercel.app');
    expect(org.logo).toBe('https://stellar-intel.vercel.app/favicons/icon-512x512.png');
    expect(Array.isArray(org.sameAs)).toBe(true);
    expect(org.sameAs).toContain('https://github.com/ezedike-evan');
    expect(org.sameAs).toContain('https://github.com/ezedike-evan/stellar-intel');
  });
});

describe('getWebSiteJsonLd', () => {
  it('emits schema.org WebSite with SearchAction potentialAction', () => {
    const website = getWebSiteJsonLd('https://stellar-intel.vercel.app');
    expect(website['@context']).toBe('https://schema.org');
    expect(website['@type']).toBe('WebSite');
    expect(website.name).toBe('Stellar Intel');
    expect(website.url).toBe('https://stellar-intel.vercel.app');
    expect(website.publisher['@type']).toBe('Organization');
    expect(website.potentialAction['@type']).toBe('SearchAction');
    expect(website.potentialAction.target['@type']).toBe('EntryPoint');
    expect(website.potentialAction.target.urlTemplate).toContain('/anchors?search=');
  });
});

describe('getRootJsonLd', () => {
  it('combines Organization and WebSite into a @graph', () => {
    const root = getRootJsonLd('https://stellar-intel.vercel.app');
    expect(root['@context']).toBe('https://schema.org');
    expect(Array.isArray(root['@graph'])).toBe(true);
    expect(root['@graph']).toHaveLength(2);
    const graph = root['@graph'] as Array<{ '@type': string }>;
    expect(graph[0]?.['@type']).toBe('Organization');
    expect(graph[1]?.['@type']).toBe('WebSite');
  });
});
