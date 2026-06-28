import React from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';

interface RatePreviewProps {
  isLoading?: boolean;
  error?: string | null;
  rate?: { pair: string; rate: number; change: number } | null;
}

export function RatePreview({ isLoading, error, rate }: RatePreviewProps) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700 animate-pulse">
        <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
        <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  if (error || !rate) {
    return (
      <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
        <p className="text-sm text-gray-400">Rates unavailable</p>
      </div>
    );
  }

  const isUp = rate.change >= 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800/50">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Best rate for NGN</p>
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold text-gray-900 dark:text-white">{rate.rate.toFixed(2)}</span>
        <span className="text-sm text-gray-500 dark:text-gray-400">{rate.pair}</span>
        <span className={lex items-center text-xs font-medium }>
          {isUp ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
          {Math.abs(rate.change).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
