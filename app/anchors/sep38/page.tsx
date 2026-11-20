/**
 * app/anchors/sep38/page.tsx
 *
 * Which anchors give firm (SEP-38) quotes and which only give estimates, from
 * live data. It nudges anchors toward SEP-38 and explains to users why some rates
 * are labelled indicative. Server component; the check itself is
 * lib/stellar/sep38-readiness.ts, shared with GET /api/v1/sep38/readiness.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { ANCHORS } from '@/constants';
import { AnchorLogo } from '@/components/ui/AnchorLogo';
import { getAllSep38Readiness } from '@/lib/stellar/sep38-readiness';

export const metadata: Metadata = {
  title: 'SEP-38 firm-quote readiness — Stellar Intel',
  description:
    'Which Stellar anchors advertise a SEP-38 quote server, answer its /info and list the asset they are registered for, and which only give estimates.',
};

export const revalidate = 600; // 10 minutes

function formatChecked(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** Text, not colour alone: the answer must survive a greyscale print or a screen reader. */
function YesNo({ value }: { value: boolean }) {
  return <span className={value ? 'text-status-up' : 'text-fg-muted'}>{value ? 'yes' : 'no'}</span>;
}

export default async function Sep38ReadinessPage() {
  const readiness = await getAllSep38Readiness();
  const nameOf = new Map(ANCHORS.map((a) => [a.id, a.name]));
  const ready = readiness.filter((r) => r.infoReachable && r.sellsRegisteredAsset);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
      <header>
        <h1 className="type-title">SEP-38 firm-quote readiness</h1>
        <p className="text-secondary-text measure mt-4 text-base">
          A firm quote (SEP-38) is a price the anchor commits to for a short time, so the amount you
          receive cannot slip. An indicative quote is an estimate from published fees and a
          reference price; the anchor sets the final rate when you deposit or withdraw. Most anchors
          give only estimates today, which is why some rates here are labelled indicative. This
          table is checked live from each anchor&apos;s own stellar.toml and quote server.{' '}
          <Link
            href="/methodology"
            className="text-primary-text hover:text-accent underline underline-offset-4"
          >
            How we measure &rarr;
          </Link>
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-fg-muted font-mono text-xs tracking-wide">
            {ready.length} of {readiness.length} ready for firm quotes
          </p>
          <Link
            href="/anchors"
            className="text-secondary-text hover:text-primary-text focus-visible:ring-accent focus-visible:ring-offset-background inline-flex h-11 items-center rounded-sm font-mono text-xs tracking-wide underline underline-offset-4 transition-colors duration-100 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            &larr; all anchors
          </Link>
        </div>
      </header>

      <div className="border-border mt-12 overflow-x-auto border-t">
        <table className="w-full min-w-[56rem] text-sm">
          <caption className="sr-only">SEP-38 readiness per anchor</caption>
          <thead>
            <tr className="text-fg-muted border-border border-b font-mono text-xs tracking-wide">
              <th scope="col" className="py-3 pr-4 text-left font-medium">
                anchor
              </th>
              <th scope="col" className="py-3 pr-4 text-left font-medium">
                declares SEP-38
              </th>
              <th scope="col" className="py-3 pr-4 text-left font-medium">
                quote server advertised
              </th>
              <th scope="col" className="py-3 pr-4 text-left font-medium">
                /info reachable
              </th>
              <th scope="col" className="py-3 pr-4 text-left font-medium">
                sells registered asset
              </th>
              <th scope="col" className="py-3 pr-4 text-left font-medium">
                assets listed
              </th>
              <th scope="col" className="py-3 text-left font-medium">
                checked at
              </th>
            </tr>
          </thead>
          <tbody>
            {readiness.map((row) => (
              <tr
                key={row.anchorId}
                className="border-border hover:bg-bg-subtle border-b align-top transition-colors duration-100 ease-out"
              >
                <td className="py-4 pr-4">
                  <div className="flex items-center gap-2">
                    <AnchorLogo
                      anchorId={row.anchorId}
                      anchorName={nameOf.get(row.anchorId) ?? row.anchorId}
                    />
                    <Link
                      href={`/anchors/${row.anchorId}`}
                      className="text-primary-text font-medium hover:underline"
                    >
                      {nameOf.get(row.anchorId) ?? row.anchorId}
                    </Link>
                  </div>
                  {row.error && <p className="text-fg-muted mt-1 text-xs">{row.error}</p>}
                </td>
                <td className="py-4 pr-4">
                  <YesNo value={row.declared} />
                </td>
                <td className="py-4 pr-4">
                  <YesNo value={row.quoteServer !== null} />
                </td>
                <td className="py-4 pr-4">
                  <YesNo value={row.infoReachable} />
                </td>
                <td className="py-4 pr-4">
                  <YesNo value={row.sellsRegisteredAsset} />
                </td>
                <td className="py-4 pr-4">
                  {row.assets.length === 0 ? (
                    <span className="text-fg-muted">0</span>
                  ) : (
                    <details>
                      <summary className="text-secondary-text focus-visible:ring-accent cursor-pointer tabular-nums focus-visible:ring-2 focus-visible:outline-none">
                        {row.assets.length}
                      </summary>
                      <ul className="mt-2 space-y-1 font-mono text-xs break-all">
                        {row.assets.map((asset) => (
                          <li key={asset} className="text-secondary-text">
                            {asset}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                <td className="text-fg-muted py-4 font-mono text-xs whitespace-nowrap">
                  {formatChecked(row.checkedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
