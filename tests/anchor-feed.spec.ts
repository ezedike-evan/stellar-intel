import { describe, expect, it } from 'vitest';
import { generateAnchorFeed, buildFeedItems } from '@/lib/stellar/feed';
import { GET } from '@/app/anchors/feed.xml/route';
import type { AnchorHealthLedger } from '@/lib/stellar/anchors';

const MOCK_LEDGER: AnchorHealthLedger = {
  thresholdNights: 3,
  updatedAt: '2026-08-30T12:00:00.000Z',
  anchors: {
    moneygram: {
      consecutiveFailures: 0,
      degraded: false,
      lastCheckedAt: '2026-08-30T12:00:00.000Z',
      lastStatus: 'ok',
      lastError: null,
    },
    mykobo: {
      consecutiveFailures: 3,
      degraded: true,
      lastCheckedAt: '2026-08-30T12:00:00.000Z',
      lastStatus: 'fail',
      lastError: 'TypeError:ENOTFOUND',
    },
  },
};

describe('Anchor Status RSS Feed (#1070)', () => {
  it('builds feed items for each anchor with accurate categories and descriptions', () => {
    const items = buildFeedItems(MOCK_LEDGER, 'https://stellar-intel.vercel.app');
    expect(items).toHaveLength(2);

    const degradedItem = items.find((i) => i.category === 'Degraded');
    expect(degradedItem).toBeDefined();
    expect(degradedItem?.title).toContain('[DEGRADED]');
    expect(degradedItem?.description).toContain('TypeError:ENOTFOUND');
    expect(degradedItem?.guid).toContain('mykobo');

    const operationalItem = items.find((i) => i.category === 'Operational');
    expect(operationalItem).toBeDefined();
    expect(operationalItem?.title).toContain('[OPERATIONAL]');
    expect(operationalItem?.guid).toContain('moneygram');
  });

  it('generates valid RSS 2.0 XML', () => {
    const xml = generateAnchorFeed(MOCK_LEDGER, 'https://stellar-intel.vercel.app');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('<channel>');
    expect(xml).toContain('<title>Stellar Intel — Anchor Health Feed</title>');
    expect(xml).toContain('<atom:link');
    expect(xml).toContain('</channel>');
    expect(xml).toContain('</rss>');
  });

  it('GET /anchors/feed.xml returns 200 with application/rss+xml content-type', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/rss+xml');
    const text = await res.text();
    expect(text).toContain('<rss version="2.0"');
  });
});
