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

describe('Route OpenGraph images (#1065)', () => {
  it('serves /anchors OG image with standard dimensions (1200x630)', () => {
    expect(anchorsSize).toEqual({ width: 1200, height: 630 });
    expect(anchorsType).toBe('image/png');
    const res = AnchorsOg();
    expect(res).toBeDefined();
  });

  it('serves /anchors/[id] OG image naming the anchor for a known anchor', async () => {
    expect(detailSize).toEqual({ width: 1200, height: 630 });
    expect(detailType).toBe('image/png');
    const res = await AnchorDetailOg({ params: Promise.resolve({ id: 'moneygram' }) });
    expect(res).toBeDefined();
  });

  it('serves /anchors/[id] OG image gracefully for an unknown anchor id', async () => {
    const res = await AnchorDetailOg({ params: Promise.resolve({ id: 'unknown-anchor' }) });
    expect(res).toBeDefined();
  });

  it('serves /anchors/standings OG image with standard dimensions', () => {
    expect(standingsSize).toEqual({ width: 1200, height: 630 });
    expect(standingsType).toBe('image/png');
    const res = StandingsOg();
    expect(res).toBeDefined();
  });

  it('serves /methodology OG image with standard dimensions', () => {
    expect(methodologySize).toEqual({ width: 1200, height: 630 });
    expect(methodologyType).toBe('image/png');
    const res = MethodologyOg();
    expect(res).toBeDefined();
  });

  it('serves /docs OG image with standard dimensions', () => {
    expect(docsSize).toEqual({ width: 1200, height: 630 });
    expect(docsType).toBe('image/png');
    const res = DocsOg();
    expect(res).toBeDefined();
  });
});
