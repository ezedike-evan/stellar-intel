import Link from 'next/link';
import { CORRIDORS } from '@/constants';
import { AnchorLogo } from '@/components/ui/AnchorLogo';
import type { Anchor } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';

const DISPLAYED_SEPS = ['sep6', 'sep24', 'sep31', 'sep38'] as const;

const SEP_LABELS: Record<(typeof DISPLAYED_SEPS)[number], string> = {
  sep6: 'SEP-6',
  sep24: 'SEP-24',
  sep31: 'SEP-31',
  sep38: 'Firm quotes',
};

function corridorLabel(corridorId: string): string {
  const corridor = CORRIDORS.find((item) => item.id === corridorId);
  return corridor ? `${corridor.from}/${corridor.to}` : corridorId.toUpperCase().replace('-', '/');
}

export function AnchorCard({ anchor }: { anchor: Anchor }) {
  const capabilities = DISPLAYED_SEPS.filter((sep) => anchor.seps?.includes(sep));

  return (
    <Link
      href={`/anchors/${anchor.id}`}
      aria-label={`View ${anchor.name} scorecard`}
      className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950"
    >
      <Card className="flex h-full flex-col p-5 transition group-hover:border-blue-300 group-hover:shadow-md dark:group-hover:border-blue-700">
        <div className="flex items-center gap-3">
          <AnchorLogo anchorId={anchor.id} anchorName={anchor.name} size="md" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{anchor.name}</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{anchor.homeDomain}</p>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Capabilities
          </p>
          <div className="mt-2 flex min-h-6 flex-wrap gap-2">
            {capabilities.length > 0 ? (
              capabilities.map((sep) => (
                <Badge key={sep} variant="info">
                  {SEP_LABELS[sep]}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-gray-500 dark:text-gray-400">None registered</span>
            )}
          </div>
        </div>

        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Corridor coverage
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {anchor.corridors.map((corridorId) => (
              <Badge key={corridorId}>{corridorLabel(corridorId)}</Badge>
            ))}
          </div>
        </div>

        <span className="mt-5 text-sm font-medium text-blue-600 group-hover:underline dark:text-blue-400">
          View scorecard <span aria-hidden="true">→</span>
        </span>
      </Card>
    </Link>
  );
}
