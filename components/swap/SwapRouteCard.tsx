'use client';
import type { SwapRoute } from '@/types';
import { formatPercent } from '@/lib/stellar';
import { ArrowRight } from 'lucide-react';

export function SwapRoutePath({ route }: { route: SwapRoute }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
      {route.path.map((asset, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ArrowRight className="h-3 w-3" />}
          <span className="font-medium text-gray-700 dark:text-gray-300">{asset.code}</span>
        </span>
      ))}
    </div>
  );
}

export function SwapRouteCard({ route }: { route: SwapRoute }) {
  return (
    <div className="space-y-1 text-sm">
      <div className="font-medium text-gray-900 dark:text-white">{route.source}</div>
      <div className="text-gray-500 dark:text-gray-400">
        Impact: {formatPercent(route.priceImpact)}
      </div>
      <SwapRoutePath route={route} />
    </div>
  );
}
