import { notFound } from 'next/navigation';
import { ANCHORS, CORRIDORS } from '@/constants';
import { buildScorecards, type OutcomeRow } from '@/lib/reputation/aggregate';
import { getHistoryBuckets } from '@/lib/reputation/buckets';
import { getReputationStore } from '@/lib/reputation/store';
import { AnchorProfile, type AnchorProfileData } from '@/components/offramp/AnchorProfile';

const STUB_METRICS: Record<
  string,
  { fillRate: number; settleP50: number; slippageP50: number; sampleSize: number }
> = {
  moneygram: { fillRate: 0.97, settleP50: 42, slippageP50: 0.003, sampleSize: 1240 },
  cowrie: { fillRate: 0.94, settleP50: 55, slippageP50: 0.005, sampleSize: 380 },
  anclap: { fillRate: 0.91, settleP50: 68, slippageP50: 0.008, sampleSize: 210 },
};

const STUB_ORACLE_TX_BY_ANCHOR: Record<string, string> = {
  moneygram: '2f14be37f87a4b6ea41a526d3f172af9c5ef4a73f70d643487d86de3979a4b10',
  cowrie: '8160ea3a9b58f49fd6b5b26bb81d35f8022a0a90c6abf11e45d2ddf35efdbd30',
  anclap: 'a0fbf3b3f0a4acdb6053dc8f6c67f51c329ef3492d90f0670ac4741f6fde1987',
};

function computeComposite(fillRate: number, settleP50: number, slippageP50: number): number {
  const fillScore = Math.min(1, Math.max(0, fillRate));
  const slippageScore = Math.min(1, Math.max(0, 1 - slippageP50 / 0.05));
  const settleScore = Math.min(1, Math.max(0, 1 - settleP50 / 300));
  const raw = 0.4 * fillScore + 0.3 * slippageScore + 0.3 * settleScore;
  return Math.round(raw * 10_000) / 10_000;
}

function anchorComposite(anchorId: string): number {
  const metrics = STUB_METRICS[anchorId] ?? {
    fillRate: 0.9,
    settleP50: 90,
    slippageP50: 0.01,
    sampleSize: 50,
  };
  return computeComposite(metrics.fillRate, metrics.settleP50, metrics.slippageP50);
}

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
  return [...ANCHORS]
    .sort((a, b) => anchorComposite(b.id) - anchorComposite(a.id))
    .slice(0, 20)
    .map((anchor) => ({ id: anchor.id }));
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

  const metrics = STUB_METRICS[anchor.id] ?? {
    fillRate: 0.9,
    settleP50: 90,
    slippageP50: 0.01,
    sampleSize: 50,
  };

  const score = scorecards[30].state === 'ok' ? scorecards[30].fillRate : metrics.fillRate;

  const profileData: AnchorProfileData = {
    id: anchor.id,
    name: anchor.name,
    homeDomain: anchor.homeDomain,
    score,
    sampleSize: scorecards[30].state === 'ok' ? scorecards[30].sampleSize : metrics.sampleSize,
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
    oracleTxId: oracleTxFromRows ?? STUB_ORACLE_TX_BY_ANCHOR[anchor.id] ?? null,
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <AnchorProfile data={profileData} />
    </main>
  );
}
