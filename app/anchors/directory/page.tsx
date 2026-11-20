import type { Metadata } from 'next';
import Link from 'next/link';
import defaultCensus from '@/constants/anchor-census-rows.json';
import { Badge } from '@/components/ui/Badge';
import { LISTED_ANCHORS } from '@/constants/listed-anchors';
import type { AnchorCensus, ListedAnchor, ListedAnchorKind, ListedCryptoRail } from '@/types';

export const metadata: Metadata = {
  title: 'Anchor directory',
  description:
    'Directory of every surveyed anchor on the Stellar network, classified by tier and supported rails, plus the operators that issue assets on Stellar or run crypto-only rails.',
};

interface SearchParams {
  tier?: string;
  kind?: string;
}

interface PageProps {
  searchParams?: Promise<SearchParams> | SearchParams;
  census?: AnchorCensus;
  /** The listed operators to show; the committed registry when omitted. */
  listed?: readonly ListedAnchor[];
}

const TIER_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'routable', label: 'Routable' },
  { id: 'health-only', label: 'Health-only' },
  { id: 'listed', label: 'Listed' },
] as const;

const SEP_BADGES = [
  { key: 'sep6', label: '6' },
  { key: 'sep24', label: '24' },
  { key: 'sep31', label: '31' },
  { key: 'sep38', label: '38' },
  { key: 'sep10', label: '10' },
] as const;

const KIND_FILTERS: ReadonlyArray<{ id: 'all' | ListedAnchorKind; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'issuer', label: 'Issuers' },
  { id: 'crypto-rails', label: 'Crypto rails' },
];

const KIND_LABELS: Record<ListedAnchorKind, string> = {
  issuer: 'Issuer',
  'crypto-rails': 'Crypto rails',
};

/** How many asset codes the Assets column spells out before saying "+n more". */
const ASSET_CODES_SHOWN = 6;

/** The directory URL with the tier and kind filters that are set, and no others. */
function directoryHref(tier: string | undefined, kind: ListedAnchorKind | undefined): string {
  const query = new URLSearchParams();
  if (tier) query.set('tier', tier);
  if (kind) query.set('kind', kind);
  const qs = query.toString();
  return qs ? `/anchors/directory?${qs}` : '/anchors/directory';
}

/** `SEP-6 · deposit BCH, USDT · withdraw BCH, ETH`; a direction with no assets is left out. */
function describeRail(rail: ListedCryptoRail): string {
  const parts = [rail.sep === 'sep6' ? 'SEP-6' : 'SEP-24'];
  if (rail.depositAssets.length > 0) parts.push(`deposit ${rail.depositAssets.join(', ')}`);
  if (rail.withdrawAssets.length > 0) parts.push(`withdraw ${rail.withdrawAssets.join(', ')}`);
  return parts.join(' · ');
}

export default async function AnchorDirectoryPage(props: PageProps) {
  const resolvedParams = props.searchParams ? await props.searchParams : undefined;
  const currentTier =
    typeof resolvedParams?.tier === 'string' &&
    ['routable', 'health-only', 'listed'].includes(resolvedParams.tier)
      ? resolvedParams.tier
      : undefined;

  // Anything but a known kind is "All", as with the tier.
  const currentKind: ListedAnchorKind | undefined =
    resolvedParams?.kind === 'issuer' || resolvedParams?.kind === 'crypto-rails'
      ? resolvedParams.kind
      : undefined;

  const listedAll = props.listed ?? LISTED_ANCHORS;
  const listedRows = [...listedAll]
    .filter((entry) => currentKind === undefined || entry.kind === currentKind)
    .sort((a, b) => a.name.localeCompare(b.name));
  const issuerCount = listedAll.filter((entry) => entry.kind === 'issuer').length;
  const cryptoOnlyCount = listedAll.length - issuerCount;

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

        <div className="mt-8 flex flex-wrap gap-2" role="group" aria-label="Filter anchors by tier">
          {TIER_FILTERS.map((filter) => {
            const isSelected =
              filter.id === 'all' ? currentTier === undefined : currentTier === filter.id;

            return (
              <Link
                key={filter.id}
                href={directoryHref(filter.id === 'all' ? undefined : filter.id, currentKind)}
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
        <p className="text-secondary-text mt-8 text-base">The census has not been generated yet.</p>
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
                    <div className="flex flex-wrap items-center gap-1">
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
                      {row.listedKind === 'crypto-rails' && <Badge>Crypto only</Badge>}
                    </div>
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

      <section aria-labelledby="listed-heading" className="mt-16">
        <h2 id="listed-heading" className="text-primary-text text-lg font-semibold">
          Issuers and crypto-only anchors
        </h2>
        <p className="text-secondary-text measure mt-2 text-base">
          Operators that issue assets on Stellar or run crypto-only rails, with no fiat payout. They
          are tracked for the record and never used for quotes or routing.
        </p>
        <p className="text-fg-muted mt-2 font-mono text-xs tracking-wide">
          {issuerCount} issuers · {cryptoOnlyCount} crypto-only
        </p>

        <div
          className="mt-6 flex flex-wrap gap-2"
          role="group"
          aria-label="Filter listed operators by kind"
        >
          {KIND_FILTERS.map((filter) => {
            const isSelected =
              filter.id === 'all' ? currentKind === undefined : currentKind === filter.id;

            return (
              <Link
                key={filter.id}
                href={directoryHref(currentTier, filter.id === 'all' ? undefined : filter.id)}
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

        {listedRows.length === 0 ? (
          <p className="text-secondary-text mt-8 text-base">No listed operators yet.</p>
        ) : (
          <div className="border-border mt-8 overflow-x-auto border-t">
            <table className="w-full min-w-[52rem] text-sm" aria-label="Listed operators">
              <caption className="sr-only">Listed operators</caption>
              <thead>
                <tr className="text-fg-muted border-border border-b font-mono text-xs tracking-wide">
                  <th scope="col" className="py-3 pr-4 text-left font-medium">
                    Operator
                  </th>
                  <th scope="col" className="py-3 pr-4 text-left font-medium">
                    Kind
                  </th>
                  <th scope="col" className="py-3 pr-4 text-left font-medium">
                    Domains
                  </th>
                  <th scope="col" className="py-3 pr-4 text-left font-medium">
                    Assets
                  </th>
                  <th scope="col" className="py-3 pr-4 text-left font-medium">
                    Rails
                  </th>
                  <th scope="col" className="py-3 text-left font-medium">
                    Registered
                  </th>
                </tr>
              </thead>
              <tbody>
                {listedRows.map((entry) => {
                  const codes = entry.assets.map((asset) => asset.code);
                  const extra = codes.length - ASSET_CODES_SHOWN;

                  return (
                    <tr
                      key={entry.id}
                      className="border-border hover:bg-bg-subtle border-b align-top transition-colors duration-100 ease-out"
                    >
                      <td className="py-4 pr-4">
                        {entry.orgUrl ? (
                          <a
                            href={entry.orgUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-text hover:text-accent font-medium underline underline-offset-4"
                          >
                            {entry.name}
                          </a>
                        ) : (
                          <span className="text-primary-text font-medium">{entry.name}</span>
                        )}
                      </td>
                      <td className="py-4 pr-4">
                        <Badge>{KIND_LABELS[entry.kind]}</Badge>
                      </td>
                      <td className="py-4 pr-4">
                        <ul className="space-y-1">
                          {entry.domains.map((domain) => (
                            <li key={domain}>
                              <a
                                href={`https://${domain}/.well-known/stellar.toml`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-secondary-text hover:text-accent font-mono text-xs underline underline-offset-4"
                              >
                                {domain}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="text-secondary-text py-4 pr-4 font-mono text-xs">
                        <span className="text-primary-text tabular-nums">{codes.length}</span>{' '}
                        {codes.slice(0, ASSET_CODES_SHOWN).join(', ')}
                        {extra > 0 && <span className="text-fg-muted"> +{extra} more</span>}
                      </td>
                      <td className="text-secondary-text py-4 pr-4 font-mono text-xs">
                        {entry.kind === 'crypto-rails' && (entry.cryptoRails?.length ?? 0) > 0 ? (
                          <ul className="space-y-1">
                            {entry.cryptoRails!.map((rail) => (
                              <li key={`${rail.sep}-${rail.transferServer}`}>
                                {describeRail(rail)}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-4">
                        {entry.registeredAnchorId ? (
                          <Link
                            href={`/anchors/${entry.registeredAnchorId}`}
                            className="text-secondary-text hover:text-primary-text font-mono text-xs underline underline-offset-4"
                          >
                            view &rarr;
                          </Link>
                        ) : (
                          <span className="text-fg-muted font-mono text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
