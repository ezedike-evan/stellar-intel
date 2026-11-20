import { describe, expect, it } from 'vitest';
import AnchorsOg, {
  size as anchorsSize,
  contentType as anchorsType,
} from '@/app/anchors/opengraph-image';
import AnchorDetailOg, {
  size as detailSize,
  contentType as detailType,
} from '@/app/anchors/[id]/opengraph-image';
import StandingsOg, {
  size as standingsSize,
  contentType as standingsType,
} from '@/app/anchors/standings/opengraph-image';
import MethodologyOg, {
  size as methodologySize,
  contentType as methodologyType,
} from '@/app/methodology/opengraph-image';
import DocsOg, { size as docsSize, contentType as docsType } from '@/app/docs/opengraph-image';
import OnrampOg, {
  alt as onrampAlt,
  size as onrampSize,
  contentType as onrampType,
} from '@/app/onramp/opengraph-image';
import { metadata as onrampMetadata } from '@/app/onramp/layout';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function assertValidPng(res: unknown): Promise<void> {
  expect(res).toBeInstanceOf(Response);
  const response = res as Response;
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('image/png');
  const buffer = await response.arrayBuffer();
  expect(buffer.byteLength).toBeGreaterThan(1000);
  const header = new Uint8Array(buffer.slice(0, 8));
  expect(Array.from(header)).toEqual(PNG_SIGNATURE);
}

describe('Route OpenGraph images (#1065)', () => {
  it('serves /anchors OG image with standard dimensions (1200x630)', async () => {
    expect(anchorsSize).toEqual({ width: 1200, height: 630 });
    expect(anchorsType).toBe('image/png');
    const res = AnchorsOg();
    await assertValidPng(res);
  });

  it('serves /anchors/[id] OG image naming the anchor for a known anchor', async () => {
    expect(detailSize).toEqual({ width: 1200, height: 630 });
    expect(detailType).toBe('image/png');
    const res = await AnchorDetailOg({ params: Promise.resolve({ id: 'moneygram' }) });
    await assertValidPng(res);
  });

  it('serves /anchors/[id] OG image gracefully for an unknown anchor id', async () => {
    const res = await AnchorDetailOg({ params: Promise.resolve({ id: 'unknown-anchor' }) });
    await assertValidPng(res);
  });

  it('serves /anchors/standings OG image with standard dimensions', async () => {
    expect(standingsSize).toEqual({ width: 1200, height: 630 });
    expect(standingsType).toBe('image/png');
    const res = StandingsOg();
    await assertValidPng(res);
  });

  it('serves /methodology OG image with standard dimensions', async () => {
    expect(methodologySize).toEqual({ width: 1200, height: 630 });
    expect(methodologyType).toBe('image/png');
    const res = MethodologyOg();
    await assertValidPng(res);
  });

  it('serves /docs OG image with standard dimensions', async () => {
    expect(docsSize).toEqual({ width: 1200, height: 630 });
    expect(docsType).toBe('image/png');
    const res = DocsOg();
    await assertValidPng(res);
  });

  it('serves /onramp OG image with standard dimensions', async () => {
    expect(onrampSize).toEqual({ width: 1200, height: 630 });
    expect(onrampType).toBe('image/png');
    const res = OnrampOg();
    await assertValidPng(res);
  });
});

describe('/onramp metadata (#1481)', () => {
  it('has its own title and description', () => {
    expect(onrampMetadata.title).toBe('Stellar on-ramp estimates — Stellar Intel');
    expect(onrampMetadata.description).toBe(
      'Compare deposit estimates across Stellar anchors and deposit straight to your own wallet.'
    );
    expect(onrampAlt).toBe(onrampMetadata.title);
  });

  it('points Open Graph at /onramp and its image route', () => {
    const og = onrampMetadata.openGraph!;
    expect(String(og.url)).toMatch(/\/onramp$/);
    const image = (og.images as Array<{ url: string; width: number; height: number }>)[0]!;
    expect(image.url).toMatch(/\/onramp\/opengraph-image$/);
    expect(image).toMatchObject({ width: 1200, height: 630 });
  });

  it('uses a large-image twitter card', () => {
    expect((onrampMetadata.twitter as { card: string }).card).toBe('summary_large_image');
  });

  it('never claims a firm rate', () => {
    const text = [onrampMetadata.title, onrampMetadata.description].join(' ');
    expect(text).not.toMatch(/\b(firm|guaranteed|live rates?)\b/i);
  });
});
