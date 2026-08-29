import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ANCHORS, CORRIDORS } from '@/constants';
import { buildScorecards, mapOutcomeRows } from '@/lib/reputation/aggregate';
import { getHistoryBuckets } from '@/lib/reputation/buckets';
import { getReputationStore, ReputationStoreUnavailableError } from '@/lib/reputation/store';
import { AnchorProfile, type AnchorProfileData } from '@/components/offramp/AnchorProfile';
import { ScorecardCard } from '@/components/offramp/ScorecardCard';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';
const DEFAULT_TITLE = 'Anchor profile — Stellar Intel';
const DEFAULT_DESCRIPTION =
  'Explore Stellar anchor reputation, corridor coverage, and recent outcomes on Stellar Intel.';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}): Promise<Metadata> {
  const { id } = await params;
  const anchor = ANCHORS.find((item) => item.id === id);
  const title = anchor ? `${anchor.name} — Stellar Intel` : DEFAULT_TITLE;
  const description = anchor
    ? `${anchor.name} reputation, corridor coverage, and recent outcomes on Stellar Intel.`
    : DEFAULT_DESCRIPTION;
  const url = new URL(anchor ? `/anchors/${anchor.id}` : '/anchors', SITE_URL).toString();

  return {
    title,
    description,
    openGraph: {
      type: 'website',
      title,
      description,
      url,
      images: [
        {
          url: new URL('/opengraph-image', SITE_URL).toString(),
          width: 1200,
          height: 630,
          alt: 'Stellar Intel — Real-time rate comparison on Stellar',
        },
      ],
    },
    alternates: {
      canonical: anchor ? `/anchors/${anchor.id}` : '/anchors',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

async function loadAnchorRows(anchorId: string) {
  try {
    return await getReputationStore().query({ anchorId });
  } catch (error) {
    // No durable store configured — `next build` prerenders this page with
    // NODE_ENV=production and no DATABASE_URL, which is expected, not a fault.
    // Matched on the error type rather than its message: this used to string-
    // match 'The postgres backend requires a SqlExecutor', which silently
    // stopped matching the moment that message changed.
    if (error instanceof ReputationStoreUnavailableError) {
      return [];
    }

    throw error;
  }
}

export const revalidate = 300;

export function generateStaticParams(): Array<{ id: string }> {
  return ANCHORS.map((anchor) => ({ id: anchor.id }));
}

export default async function AnchorDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const { id } = await params;
  const anchor = ANCHORS.find((item) => item.id === id);
  if (!anchor) notFound();

  const rows = await loadAnchorRows(anchor.id);
  const outcomeRows = mapOutcomeRows(rows);
  const history = getHistoryBuckets(anchor.id, '30d', outcomeRows);

  // The most recently mirrored-to-Soroban row for this anchor: real on-chain
  // tx hash + when the publisher submitted it (packages/publisher writes
  // oracle_tx_hash/published_at back to outcome_log after submit_outcome).
  // Distinct from stellar_transaction_id, which is the off-chain settlement
  // payment the reconciler looks up on Horizon.
  const lastPublished = [...rows]
    .reverse()
    .find((row) => row.oracleTxHash !== null && row.publishedAt !== null);

  const scorecards = buildScorecards(outcomeRows, Date.now(), lastPublished?.publishedAt ?? null);

  const disputes: AnchorProfileData['disputes'] = rows
    .filter(
      (row) => row.outcome === 'refunded' || row.outcome === 'error' || row.outcome === 'partial'
    )
    .slice(-10)
    .reverse()
    .map((row) => ({
      id: row.intentHash,
      createdAt: row.createdAt,
      reason:
        row.outcome === 'refunded'
          ? 'Refunded transaction'
          : row.outcome === 'partial'
            ? 'Partial completion'
            : 'Failed transaction',
      status: row.outcome === 'error' ? 'open' : 'resolved',
    }));

  const score = scorecards[30].state === 'ok' ? scorecards[30].fillRate : null;

  const profileData: AnchorProfileData = {
    id: anchor.id,
    name: anchor.name,
    homeDomain: anchor.homeDomain,
    score,
    sampleSize: scorecards[30].state === 'ok' ? scorecards[30].sampleSize : rows.length,
    corridors: anchor.corridors
      .map((corridorId) => {
        const corridor = CORRIDORS.find((item) => item.id === corridorId);
        if (!corridor) return null;
        return {
          id: corridor.id,
          from: corridor.from,
          to: corridor.to,
          countryName: corridor.countryName,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
    history: history.buckets,
    disputes,
    oracleTxId: lastPublished?.oracleTxHash ?? null,
  };

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <AnchorProfile data={profileData} />
      <ScorecardCard
        anchorId={anchor.id}
        window="30d"
        latestOracleTxHash={lastPublished?.oracleTxHash ?? undefined}
      />
    </main>
  );
}
