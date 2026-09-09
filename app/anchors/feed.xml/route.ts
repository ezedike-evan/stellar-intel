import { NextResponse } from 'next/server';
import { getAnchorHealthLedger } from '@/lib/stellar/anchors';
import { generateAnchorFeed } from '@/lib/stellar/feed';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ledger = getAnchorHealthLedger();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';
  const feedXml = generateAnchorFeed(ledger, siteUrl);

  return new NextResponse(feedXml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
