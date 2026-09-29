import type { Metadata } from 'next';
import Link from 'next/link';
import defaultCensus from '@/constants/anchor-census.json';
import { Badge } from '@/components/ui/Badge';
import type { AnchorCensus } from '@/types';

export const metadata: Metadata = {
  title: 'Anchor directory',
  description:
    'Directory of every surveyed anchor on the Stellar network, classified by tier and supported rails.',
};

interface PageProps {
  searchParams?: Promise<{ tier?: string }> | { tier?: string };
  census?: AnchorCensus;
}

const TIER_FILTERS = [
  { id: 'all', label: 'All', href: '/anchors/directory' },
  { id: 'routable', label: 'Routable', href: '/anchors/directory?tier=routable' },
  { id: 'health-only', label: 'Health-only', href: '/anchors/directory?tier=health-only' },
  { id: 'listed', label: 'Listed', href: '/anchors/directory?tier=listed' },
] as const;

const SEP_BADGES = [
  { key: 'sep6', label: '6' },
  { key: 'sep24', label: '24' },
  { key: 'sep31', label: '31' },
  { key: 'sep38', label: '38' },
  { key: 'sep10', label: '10' },
] as const;

export default async function AnchorDirectoryPage(props: PageProps) {
  const resolvedParams = props.searchParams ? await props.searchParams : undefined;
  const currentTier =
    typeof resolvedParams?.tier === 'string' &&
    ['routable', 'health-only', 'listed'].includes(resolvedParams.tier)
      ? resolvedParams.tier
      : undefined;

  const census = (props.census ?? defaultCensus) as AnchorCensus;
  const allRows = census.rows ?? [];
  const rows = currentTier ? allRows.filter((row) => row.tier === currentTier) : allRows;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
      <header>
        <h1 className="type-title">Anchor directory</h1>
        <p className="text-secondary-text measure mt-4 text-base">
          Routable anchors maintain live withdrawal rails, health-only anchors advertise transfer
          SEPs without a proven withdraw rail, and listed anchors are reachable issuer-only or
          unconfirmed.
        </p>
        {census.generatedAt && (
          <p className="text-fg-muted font-mono text-xs tracking-wide mt-2">
            Generated: <time dateTime={census.generatedAt}>{census.generatedAt}</time>
          </p>
        )}

        <div
          className="mt-8 flex flex-wrap gap-2"
          role="group"
          aria-label="Filter anchors by tier"
        >
          {TIER_FILTERS.map((filter) => {
            const isSelected =
              filter.id === 'all' ? currentTier === undefined : currentTier === filter.id;

            return (
              <Link
                key={filter.id}
                href={filter.href}
                aria-current={isSelected ? 'page' : undefined}
                className={
                  isSelected
                    ? 'border-control-border bg-bg-subtle text-primary-text focus-visible:ring-accent focus-visible:ring-offset-background inline-flex h-11 items-center rounded-sm border px-4 font-mono text-xs tracking-wide focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none'
                    : 'border-border text-secondary-text hover:text-primary-text hover:border-control-border focus-visible:ring-accent focus-visible:ring-offset-background inline-flex h-11 items-center rounded-sm border px-4 font-mono text-xs tracking-wide transition-colors duration-100 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none'
                }
              >
                {filter.label}
              </Link>
            );
          })}
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="text-secondary-text mt-8 text-base">
          The census has not been generated yet.
        </p>
      ) : (
        <div className="border-border mt-8 overflow-x-auto border-t">
          <table className="w-full min-w-[52rem] text-sm" aria-label="Anchor directory">
            <caption className="sr-only">Anchor directory</caption>
            <thead>
              <tr className="text-fg-muted border-border border-b font-mono text-xs tracking-wide">
                <th scope="col" className="py-3 pr-4 text-left font-medium">
                  Domain
                </th>
                <th scope="col" className="py-3 pr-4 text-left font-medium">
                  Tier
                </th>
                <th scope="col" className="py-3 pr-4 text-left font-medium">
                  SEPs
                </th>
                <th scope="col" className="py-3 pr-4 text-left font-medium">
                  Withdraw assets
                </th>
                <th scope="col" className="py-3 pr-4 text-left font-medium">
                  Receive (SEP-31)
                </th>
                <th scope="col" className="py-3 pr-4 text-left font-medium">
                  Sources
                </th>
                <th scope="col" className="py-3 text-left font-medium">
                  Registered
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.domain}
                  className="border-border hover:bg-bg-subtle border-b transition-colors duration-100 ease-out"
                >
                  <td className="py-4 pr-4">
                    <a
                      href={`https://${row.domain}/.well-known/stellar.toml`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-text hover:text-accent font-medium underline underline-offset-4"
                    >
                      {row.domain}
                    </a>
                  </td>
                  <td className="py-4 pr-4">
                    <Badge
                      variant={
                        row.tier === 'routable'
                          ? 'success'
                          : row.tier === 'health-only'
                            ? 'warning'
                            : 'default'
                      }
                    >
                      {row.tier}
                    </Badge>
                  </td>
                  <td className="py-4 pr-4">
                    <div className="flex flex-wrap gap-1">
                      {SEP_BADGES.map(({ key, label }) =>
                        row.seps?.[key] ? (
                          <Badge key={key} variant="info">
                            {label}
                          </Badge>
                        ) : null
                      )}
                    </div>
                  </td>
                  <td className="text-secondary-text py-4 pr-4 font-mono text-xs">
                    {row.withdrawAssets?.length > 0 ? row.withdrawAssets.join(', ') : '—'}
                  </td>
                  <td className="text-secondary-text py-4 pr-4 font-mono text-xs">
                    {row.receiveAssets?.length > 0 ? row.receiveAssets.join(', ') : '—'}
                  </td>
                  <td className="text-fg-muted py-4 pr-4 font-mono text-xs">
                    {row.sources?.length > 0 ? row.sources.join(', ') : '—'}
                  </td>
                  <td className="py-4">
                    {row.registeredAnchorId ? (
                      <Link
                        href={`/anchors/${row.registeredAnchorId}`}
                        className="text-secondary-text hover:text-primary-text underline underline-offset-4 font-mono text-xs"
                      >
                        view &rarr;
                      </Link>
                    ) : (
                      <span className="text-fg-muted font-mono text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
