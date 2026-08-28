import type { AnchorRate } from '@/types';
import { formatCurrency, formatRate } from '@/lib/utils';

const FEE_TYPE_LABELS: Record<AnchorRate['feeType'], string> = {
  flat: 'Flat fee',
  percent: 'Percentage fee',
  combined: 'Flat + percentage fee',
};

const SOURCE_LABELS: Record<AnchorRate['source'], string> = {
  sep38: 'Firm quote (SEP-38)',
  'sep24-fee': 'Indicative (SEP-24)',
  'sep6-info': 'Indicative (SEP-6 /info)',
  'sep6-fee': 'Indicative (SEP-6 /fee)',
  unavailable: 'Unavailable',
};

const QUOTE_STATUS_LABELS: Record<NonNullable<AnchorRate['quoteStatus']>, string> = {
  firm: 'Firm',
  expiring: 'Expiring soon',
  refreshing: 'Refreshing',
};

interface RateRowDetailProps {
  rate: AnchorRate;
  currency: string;
  colSpan: number;
}

export function RateRowDetail({ rate, currency, colSpan }: RateRowDetailProps) {
  return (
    <tr className="border-t border-border bg-bg-sunken/50 /30">
      <td colSpan={colSpan} className="px-4 py-3">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-fg-muted">Fee</dt>
            <dd className="font-medium text-primary-text">
              {rate.fee !== null ? formatCurrency(rate.fee, 'USD') : '—'} (
              {FEE_TYPE_LABELS[rate.feeType]})
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">Rate</dt>
            <dd className="font-medium text-primary-text">
              {rate.exchangeRate !== null && rate.exchangeRate > 0
                ? formatRate(rate.exchangeRate, 'USDC', currency)
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">You receive</dt>
            <dd className="font-medium text-primary-text">
              {rate.totalReceived !== null ? formatCurrency(rate.totalReceived, currency) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">Quote type</dt>
            <dd className="font-medium text-primary-text">{SOURCE_LABELS[rate.source]}</dd>
          </div>
          {rate.quoteStatus && (
            <div>
              <dt className="text-fg-muted">Quote status</dt>
              <dd className="font-medium text-primary-text">
                {QUOTE_STATUS_LABELS[rate.quoteStatus]}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-fg-muted">Last updated</dt>
            <dd className="font-medium text-primary-text">{rate.updatedAt.toLocaleTimeString()}</dd>
          </div>
        </dl>
      </td>
    </tr>
  );
}
