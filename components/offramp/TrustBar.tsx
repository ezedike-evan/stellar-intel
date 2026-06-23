'use client';

import { useMemo } from 'react';
import { ScoreBadge } from '@/components/ui/ScoreBadge';

export interface AnchorTrustScore {
  anchorId: string;
  anchorName: string;
  logoUrl?: string;
  compositeScore: number;
  corridors: string[];
}

interface TrustBarProps {
  scores: AnchorTrustScore[];
  corridor: string;
  onAnchorClick?: (anchorId: string) => void;
}

export function TrustBar({ scores, corridor, onAnchorClick }: TrustBarProps) {
  const topThree = useMemo(
    () =>
      scores
        .filter((s) => s.corridors.includes(corridor))
        .sort((a, b) => b.compositeScore - a.compositeScore)
        .slice(0, 3),
    [scores, corridor]
  );

  if (topThree.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800/50">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Top Anchors by Trust Score
      </p>
      <div className="flex gap-3">
        {topThree.map((score, rank) => (
          <TrustBarItem
            key={score.anchorId}
            score={score}
            rank={rank + 1}
            onClick={onAnchorClick}
          />
        ))}
      </div>
    </div>
  );
}

interface TrustBarItemProps {
  score: AnchorTrustScore;
  rank: number;
  onClick?: ((anchorId: string) => void) | undefined;
}

function TrustBarItem({ score, rank, onClick }: TrustBarItemProps) {
  const scorePercent = Math.round(score.compositeScore * 100);

  const handleClick = () => {
    if (onClick) {
      onClick(score.anchorId);
    } else {
      const el = document.getElementById(`anchor-row-${score.anchorId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <button
      onClick={handleClick}
      className="flex flex-1 cursor-pointer items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-left transition-colors hover:border-blue-200 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
        {rank}
      </span>
      {score.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={score.logoUrl}
          alt={score.anchorName}
          className="h-7 w-7 shrink-0 rounded-full object-contain"
        />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {score.anchorName.charAt(0).toUpperCase()}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
          {score.anchorName}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1.5">
          <ScoreBadge score={scorePercent} />
          trust score
        </p>
      </div>
    </button>
  );
}
