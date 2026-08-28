import Link from 'next/link';
import { CORRIDORS } from '@/constants';
import { AnchorLogo } from '@/components/ui/AnchorLogo';
import type { Anchor } from '@/types';
import { Badge } from '@/components/ui/Badge';

const DISPLAYED_SEPS = ['sep6', 'sep24', 'sep31', 'sep38'] as const;

const SEP_LABELS: Record<(typeof DISPLAYED_SEPS)[number], string> = {
  sep6: 'SEP-6',
  sep24: 'SEP-24',
  sep31: 'SEP-31',
  // Was "Firm quotes", which reads as a delivered capability. SEP-38 in a
  // stellar.toml means the anchor says it runs a quote server; whether it
  // answers, and for which corridor, is a separate question — and the one this
  // product exists to ask. Name the protocol, not the promise.
  sep38: 'SEP-38',
};

function corridorLabel(corridorId: string): string {
  const corridor = CORRIDORS.find((item) => item.id === corridorId);
  return corridor ? `${corridor.from}/${corridor.to}` : corridorId.toUpperCase().replace('-', '/');
}

/**
 * Everything on this card is a declaration — what the anchor publishes about
 * itself. It is laid out as a record entry rather than a marketing card: no
 * shadow, no hover lift, one border that changes on hover.
 */
export function AnchorCard({ anchor }: { anchor: Anchor }) {
  const capabilities = DISPLAYED_SEPS.filter((sep) => anchor.seps?.includes(sep));

  return (
    <Link
      href={`/anchors/${anchor.id}`}
      aria-label={`View ${anchor.name} scorecard`}
      className="group border-border hover:border-control-border hover:bg-bg-subtle focus-visible:ring-accent focus-visible:ring-offset-background block h-full rounded-sm border p-5 transition-colors duration-100 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      <div className="flex items-center gap-3">
        <AnchorLogo anchorId={anchor.id} anchorName={anchor.name} size="md" />
        <div className="min-w-0">
          <h3 className="truncate text-base font-medium">{anchor.name}</h3>
          <p className="text-fg-muted mt-1 truncate font-mono text-xs">{anchor.homeDomain}</p>
        </div>
      </div>

      <div className="mt-5">
        <p className="text-fg-muted font-mono text-xs tracking-wide">advertises</p>
        <div className="mt-2 flex min-h-6 flex-wrap gap-1.5">
          {capabilities.length > 0 ? (
            capabilities.map((sep) => (
              <Badge key={sep} variant={sep === 'sep38' ? 'success' : 'info'}>
                {SEP_LABELS[sep]}
              </Badge>
            ))
          ) : (
            <span className="text-fg-muted text-sm">none registered</span>
          )}
        </div>
      </div>

      <div className="mt-5">
        <p className="text-fg-muted font-mono text-xs tracking-wide">corridors</p>
        <p className="text-secondary-text mt-2 font-mono text-xs">
          {anchor.corridors.map(corridorLabel).join(' · ')}
        </p>
      </div>

      <span className="text-secondary-text group-hover:text-primary-text mt-5 inline-block font-mono text-xs tracking-wide underline underline-offset-4 transition-colors">
        view scorecard <span aria-hidden="true">&rarr;</span>
      </span>
    </Link>
  );
}
