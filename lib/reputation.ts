import { CORRIDORS, KNOWN_ANCHORS } from '@/constants';

export type LeaderboardSortKey = 'composite' | 'fillRate' | 'settleP50' | 'slippage';
export type LeaderboardDirection = 'asc' | 'desc';

export interface AnchorLeaderboardEntry {
  anchorId: string;
  anchorName: string;
  corridorId: string | null;
  composite: number;
  fillRate: number;
  settleP50: number;
  slippage: number;
}

export interface AnchorLeaderboardData {
  entries: AnchorLeaderboardEntry[];
  corridorId: string | null;
  sortKey: LeaderboardSortKey;
  direction: LeaderboardDirection;
}

const DEFAULT_METRICS: Record<
  string,
  Omit<AnchorLeaderboardEntry, 'anchorId' | 'anchorName' | 'corridorId'>
> = {
  moneygram: { composite: 91.8, fillRate: 0.95, settleP50: 22, slippage: 1.1 },
  cowrie: { composite: 92.4, fillRate: 0.96, settleP50: 16, slippage: 0.7 },
  anclap: { composite: 87.8, fillRate: 0.9, settleP50: 25, slippage: 1.9 },
};

const CORRIDOR_METRICS: Record<
  string,
  Partial<Record<string, Omit<AnchorLeaderboardEntry, 'anchorId' | 'anchorName' | 'corridorId'>>>
> = {
  'usdc-ngn': {
    moneygram: { composite: 95.3, fillRate: 0.97, settleP50: 18, slippage: 0.6 },
    cowrie: { composite: 94.8, fillRate: 0.98, settleP50: 14, slippage: 0.5 },
  },
  'usdc-kes': {
    moneygram: { composite: 93.1, fillRate: 0.95, settleP50: 20, slippage: 1.0 },
  },
  'usdc-ghs': {
    moneygram: { composite: 91.7, fillRate: 0.94, settleP50: 24, slippage: 1.3 },
  },
  'usdc-mxn': {
    moneygram: { composite: 90.3, fillRate: 0.93, settleP50: 26, slippage: 1.8 },
  },
  'usdc-brl': {
    moneygram: { composite: 90.9, fillRate: 0.94, settleP50: 28, slippage: 1.6 },
  },
  'usdc-ars': {
    anclap: { composite: 88.1, fillRate: 0.91, settleP50: 24, slippage: 2.0 },
  },
  'usdc-pen': {
    anclap: { composite: 87.4, fillRate: 0.9, settleP50: 26, slippage: 2.2 },
  },
};

function normalizeSortKey(value: string | undefined): LeaderboardSortKey {
  switch (value) {
    case 'fillRate':
    case 'settleP50':
    case 'slippage':
      return value;
    default:
      return 'composite';
  }
}

function normalizeDirection(value: string | undefined): LeaderboardDirection {
  return value === 'asc' ? 'asc' : 'desc';
}

function getAnchorMetrics(
  anchorId: string,
  corridorId?: string
): Omit<AnchorLeaderboardEntry, 'anchorId' | 'anchorName' | 'corridorId'> {
  if (corridorId && CORRIDOR_METRICS[corridorId]?.[anchorId]) {
    return CORRIDOR_METRICS[corridorId]![anchorId]!;
  }

  return DEFAULT_METRICS[anchorId] ?? { composite: 0, fillRate: 0, settleP50: 0, slippage: 0 };
}

function getAnchorEntries(corridorId?: string): AnchorLeaderboardEntry[] {
  const selectedCorridor = CORRIDORS.find((corridor) => corridor.id === corridorId);

  return KNOWN_ANCHORS.filter((anchor) => {
    if (!selectedCorridor) return true;
    return anchor.corridors.includes(selectedCorridor.id);
  }).map((anchor) => ({
    anchorId: anchor.id,
    anchorName: anchor.name,
    corridorId: selectedCorridor?.id ?? null,
    ...getAnchorMetrics(anchor.id, selectedCorridor?.id),
  }));
}

function sortLeaderboard(
  entries: AnchorLeaderboardEntry[],
  sortKey: LeaderboardSortKey,
  direction: LeaderboardDirection
): AnchorLeaderboardEntry[] {
  const modifier = direction === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    const diff = a[sortKey] - b[sortKey];
    if (diff !== 0) return diff * modifier;
    return a.anchorName.localeCompare(b.anchorName) * modifier;
  });
}

export function buildLeaderboardData(
  corridorId?: string,
  sortKeyValue?: string,
  directionValue?: string
): AnchorLeaderboardData {
  const sortKey = normalizeSortKey(sortKeyValue);
  const direction = normalizeDirection(directionValue);
  const entries = getAnchorEntries(corridorId);

  return {
    entries: sortLeaderboard(entries, sortKey, direction),
    corridorId: CORRIDORS.some((corridor) => corridor.id === corridorId)
      ? (corridorId ?? null)
      : null,
    sortKey,
    direction,
  };
}

export function getLeaderboardSortKey(value: string | undefined): LeaderboardSortKey {
  return normalizeSortKey(value);
}

export function getLeaderboardDirection(value: string | undefined): LeaderboardDirection {
  return normalizeDirection(value);
}
