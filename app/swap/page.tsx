'use client';
import { useState } from 'react';
import { RefreshCw, ArrowLeftRight } from 'lucide-react';
import { AssetSelector } from '@/components/swap/AssetSelector';
import { SwapRoutePath } from '@/components/swap/SwapRouteCard';
import { RateTable, type RateTableColumn, type RateTableRow } from '@/components/ui/RateTable';
import { Button } from '@/components/ui/Button';
import { useSwapRoutes } from '@/hooks/useSwapRoutes';
import { USDC_ASSET, XLM_ASSET } from '@/constants';
import { formatPercent } from '@/lib/stellar';
import type { StellarAsset } from '@/types';

const COLUMNS: RateTableColumn[] = [
  { key: 'source', label: 'Route / DEX' },
  { key: 'receive', label: 'You receive' },
  { key: 'price', label: 'Price' },
  { key: 'impact', label: 'Price Impact' },
  { key: 'fee', label: 'Fee' },
  { key: 'path', label: 'Path' },
];

export default function SwapPage() {
  const [fromAsset, setFromAsset] = useState<StellarAsset>(USDC_ASSET);
  const [toAsset, setToAsset] = useState<StellarAsset>(XLM_ASSET);
  const [fromAmount, setFromAmount] = useState(100);
  const [selectedId, setSelectedId] = useState<string>();

  const { data: routes, isLoading, mutate } = useSwapRoutes(fromAsset, toAsset, fromAmount);

  const rows: RateTableRow[] = (routes ?? []).map((r) => ({
    id: r.routeId,
    isBest: r.isBest,
    isMock: r.isMock,
    cells: {
      source: r.source,
      receive: `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(r.toAmount)} ${r.toAsset.code}`,
      price: `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(r.price)} ${r.toAsset.code}/${r.fromAsset.code}`,
      impact: (
        <span
          className={r.priceImpact > 0.01 ? 'text-red-500' : 'text-gray-600 dark:text-gray-400'}
        >
          {formatPercent(r.priceImpact)}
        </span>
      ),
      fee: `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(r.fee)} ${r.fromAsset.code}`,
      path: <SwapRoutePath route={r} />,
    },
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Swap Router</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Compare swap prices across SDEX and Stellar AMMs
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50 sm:grid-cols-3">
        <AssetSelector label="From" value={fromAsset} onChange={setFromAsset} exclude={toAsset} />
        <div className="flex items-end">
          <div className="w-full">
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Amount
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                value={fromAmount}
                onChange={(e) => setFromAmount(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  const tmp = fromAsset;
                  setFromAsset(toAsset);
                  setToAsset(tmp);
                }}
                title="Swap assets"
              >
                <ArrowLeftRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
        <AssetSelector label="To" value={toAsset} onChange={setToAsset} exclude={fromAsset} />
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => mutate()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <RateTable
        columns={COLUMNS}
        rows={rows}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onExecute={(id) => alert(`Executing swap via ${id} — wallet integration coming soon`)}
        isLoading={isLoading}
        caption="SDEX routes are live via Horizon. // MOCK data for Soroswap, Phoenix, Aquarius."
      />
    </div>
  );
}
