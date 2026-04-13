'use client';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { RateTable, type RateTableColumn, type RateTableRow } from '@/components/ui/RateTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useYieldRates } from '@/hooks/useYieldRates';
import { formatPercent, formatTVL, formatAmount } from '@/lib/stellar';
import type { YieldAsset } from '@/types';

const ASSETS: Array<{ value: YieldAsset | 'all'; label: string }> = [
  { value: 'all', label: 'All Assets' },
  { value: 'USDC', label: 'USDC' },
  { value: 'XLM', label: 'XLM' },
  { value: 'USDY', label: 'USDY' },
  { value: 'EURC', label: 'EURC' },
];

const COLUMNS: RateTableColumn[] = [
  { key: 'provider', label: 'Protocol' },
  { key: 'asset', label: 'Asset' },
  { key: 'apy', label: 'APY' },
  { key: 'tvl', label: 'TVL' },
  { key: 'min', label: 'Min Deposit' },
  { key: 'lockup', label: 'Lock-up' },
  { key: 'risk', label: 'Risk' },
];

export default function YieldPage() {
  const [asset, setAsset] = useState<YieldAsset | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string>();

  const { data: rates, isLoading, mutate } = useYieldRates(asset === 'all' ? undefined : asset);

  const rows: RateTableRow[] = (rates ?? []).map((r) => ({
    id: r.protocolId,
    isBest: r.isBest,
    isMock: r.isMock,
    riskLevel: r.riskLevel,
    cells: {
      provider: r.protocolName,
      asset: r.asset,
      apy: formatPercent(r.apy),
      tvl: formatTVL(r.tvl),
      min: formatAmount(r.minDeposit),
      lockup: r.lockupDays === 0 ? 'None' : `${r.lockupDays} days`,
      risk: <Badge risk={r.riskLevel}>{r.riskLevel}</Badge>,
    },
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Yield Comparator</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Compare APY across Stellar yield protocols
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {ASSETS.map(({ value, label }) => (
          <Button
            key={value}
            variant={asset === value ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setAsset(value)}
          >
            {label}
          </Button>
        ))}
        <div className="ml-auto">
          <Button variant="ghost" size="sm" onClick={() => mutate()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      <RateTable
        columns={COLUMNS}
        rows={rows}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onExecute={(id) => alert(`Depositing into ${id} — wallet integration coming soon`)}
        isLoading={isLoading}
        caption="// MOCK data for Blend, DeFindex, BENJI, USDY — replace with live protocol APIs."
      />
    </div>
  );
}
