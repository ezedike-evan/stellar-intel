import { notFound } from 'next/navigation';
import { ANCHORS, CORRIDORS } from '@/constants';
import { buildScorecards, type OutcomeRow } from '@/lib/reputation/aggregate';
import { getHistoryBuckets } from '@/lib/reputation/buckets';
import { getReputationStore } from '@/lib/reputation/store';
import { AnchorProfile, type AnchorProfileData } from '@/components/offramp/AnchorProfile';

function mapOutcomeRows(
  rows: Awaited<ReturnType<ReturnType<typeof getReputationStore>['query']>>
): OutcomeRow[] {
  return rows.map((row) => ({
    intentHash: row.intentHash,
    anchorId: row.anchorId,
    filled: row.outcome === 'completed',
    settleMs: row.settleSeconds !== null ? row.settleSeconds * 1000 : null,
    slippage:
      row.deliveredRate !== null
        ? Math.max(0, 1 - Number.parseFloat(row.deliveredRate) / Number.parseFloat(row.quotedRate))
        : null,
    recordedAt: new Date(row.createdAt).getTime(),
  }));
}

async function loadAnchorRows(anchorId: string) {
  try {
    return await getReputationStore().query({ anchorId });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('The postgres backend requires a SqlExecutor')
    ) {
      return [];
    }

    throw error;
  }
}

export const revalidate = 300;

export function generateStaticParams(): Array<{ id: string }> {
  return [...ANCHORS].slice(0, 20).map((anchor) => ({ id: anchor.id }));
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
  const scorecards = buildScorecards(outcomeRows);

  const oracleTxFromRows = [...rows]
    .reverse()
    .find(
      (row) =>
        typeof row.stellarTransactionId === 'string' &&
        /^[0-9a-fA-F]{64}$/.test(row.stellarTransactionId)
    )?.stellarTransactionId;

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
    oracleTxId: oracleTxFromRows ?? null,
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <AnchorProfile data={profileData} />
    </main>
  );
}
