/**
 * lib/stellar/feed.ts
 *
 * Generates an RSS 2.0 feed of anchor health transitions (#1070).
 * Provides a machine-readable stream for automated monitoring and crawlers.
 */

import { ANCHORS } from '@/constants/anchors';
import type { AnchorHealthLedger } from '@/lib/stellar/anchors';

export interface FeedItem {
  title: string;
  link: string;
  guid: string;
  pubDate: string;
  description: string;
  category: string;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildFeedItems(
  ledger: AnchorHealthLedger,
  siteUrl: string = 'https://stellar-intel.vercel.app'
): FeedItem[] {
  const base = siteUrl.replace(/\/+$/, '');
  const items: FeedItem[] = [];

  for (const [id, health] of Object.entries(ledger.anchors)) {
    const anchor = ANCHORS.find((a) => a.id.toLowerCase() === id.toLowerCase());
    const name = anchor ? anchor.name : id;
    const dateStr = health.lastCheckedAt ?? ledger.updatedAt ?? new Date().toISOString();
    const pubDate = new Date(dateStr).toUTCString();

    if (health.degraded) {
      const errorMsg = health.lastError ? ` Last error: ${health.lastError}.` : '';
      items.push({
        title: `[DEGRADED] ${name} (${id}) marked degraded`,
        link: `${base}/anchors/${id}`,
        guid: `${base}/anchors/${id}#degraded-${dateStr}`,
        pubDate,
        description: `${name} has reached ${health.consecutiveFailures} consecutive probe failures and is flagged degraded.${errorMsg}`,
        category: 'Degraded',
      });
    } else {
      items.push({
        title: `[OPERATIONAL] ${name} (${id}) operating normally`,
        link: `${base}/anchors/${id}`,
        guid: `${base}/anchors/${id}#operational-${dateStr}`,
        pubDate,
        description: `${name} is operational and passing health checks.`,
        category: 'Operational',
      });
    }
  }

  // Sort newest first
  items.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
  return items;
}

export function generateAnchorFeed(
  ledger: AnchorHealthLedger,
  siteUrl: string = 'https://stellar-intel.vercel.app'
): string {
  const base = siteUrl.replace(/\/+$/, '');
  const items = buildFeedItems(ledger, base);
  const lastBuildDate = ledger.updatedAt
    ? new Date(ledger.updatedAt).toUTCString()
    : new Date().toUTCString();

  const itemsXml = items
    .map(
      (item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>
      <pubDate>${item.pubDate}</pubDate>
      <category>${escapeXml(item.category)}</category>
      <description>${escapeXml(item.description)}</description>
    </item>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Stellar Intel — Anchor Health Feed</title>
    <link>${base}/anchors</link>
    <description>Live machine-readable stream of anchor health status transitions across the Stellar fleet.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${base}/anchors/feed.xml" rel="self" type="application/rss+xml"/>
${itemsXml}
  </channel>
</rss>`;
}
