'use client';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { CountrySelector } from '@/components/offramp/CountrySelector';
import { RateTable, type RateTableColumn, type RateTableRow } from '@/components/ui/RateTable';
import { Button } from '@/components/ui/Button';
import { useOnrampRates } from '@/hooks/useAnchorRates';
import { SUPPORTED_COUNTRIES } from '@/constants';
import { formatAmount, formatPercent } from '@/lib/stellar';
import type { Country } from '@/types';

const COLUMNS: RateTableColumn[] = [
  { key: 'provider', label: 'Provider' },
  { key: 'methods', label: 'Deposit Methods' },
  { key: 'fee', label: 'Fee' },
  { key: 'receive', label: 'USDC Received' },
  { key: 'time', label: 'Est. time' },
];

export default function OnrampPage() {
  const [country, setCountry] = useState<Country>(SUPPORTED_COUNTRIES[0]);
  const [localAmount, setLocalAmount] = useState(10000);
  const [selectedId, setSelectedId] = useState<string>();

  const {
    data: rates,
    isLoading,
    mutate,
  } = useOnrampRates(country.code, country.currency, localAmount);

  const rows: RateTableRow[] = (rates ?? []).map((r) => ({
    id: r.anchorId,
    isBest: r.isBest,
    isMock: r.isMock,
    cells: {
      provider: r.anchorName,
      methods: r.depositMethods
        .map((m) =>
          m === 'bank_transfer'
            ? 'Bank'
            : m === 'mobile_money'
              ? 'Mobile Money'
              : m === 'cash'
                ? 'Cash'
                : 'Card'
        )
        .join(', '),
      fee: `${formatAmount(r.fee)} + ${formatPercent(r.feePercent)}`,
      receive:
        r.totalReceived != null
          ? `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(r.totalReceived)} USDC`
          : '—',
      time: r.estimatedTime,
    },
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">On-ramp Comparator</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Compare deposit fees to buy USDC via Stellar anchors
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50 sm:grid-cols-3">
        <CountrySelector value={country.code} onChange={setCountry} />
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Amount ({country.currency})
          </label>
          <input
            type="number"
            min={1}
            value={localAmount}
            onChange={(e) => setLocalAmount(Number(e.target.value))}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
        </div>
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
        onExecute={(id) => alert(`On-ramp via ${id} — wallet integration coming soon`)}
        isLoading={isLoading}
        caption="// MOCK data — connect to real SEP-24 endpoints for production."
      />
    </div>
  );
}
