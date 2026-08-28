import Link from 'next/link';
import { ANCHORS, CORRIDORS } from '@/constants';

const SEP_ORDER = ['sep6', 'sep10', 'sep24', 'sep31', 'sep38'] as const;

/**
 * The registry, stated plainly.
 *
 * This replaces a row of anchor logos. A logo wall asserts credibility by
 * association and says nothing checkable; these are the seven anchors the
 * record actually covers, with the corridors they are registered for and the
 * SEPs they advertise — every value read from `constants/anchors.ts`, so the
 * page cannot drift from the registry it describes.
 *
 * The SEP-38 column is the point. Exactly one of seven anchors advertises a
 * quote server, which is why `docs/POSITIONING.md` retires the claim that this
 * product compares firm quotes across anchors today. Showing the count is more
 * persuasive than any sentence about rigour, and it costs nothing to verify.
 */
export function AnchorRegistry() {
  const corridorLabel = (id: string) => CORRIDORS.find((c) => c.id === id)?.to ?? id;
  const withQuoteServer = ANCHORS.filter((a) => a.seps?.includes('sep38')).length;

  return (
    <section aria-labelledby="registry-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="registry-heading" className="type-title">
          The seven
        </h2>
        <p className="text-fg-muted font-mono text-xs tracking-wide">
          {withQuoteServer} of {ANCHORS.length} advertise a quote server
        </p>
      </div>

      <p className="text-secondary-text measure mt-4 text-base">
        Every anchor in the registry, the corridors it is registered for, and the SEPs it says it
        supports. What it actually did on those endpoints is the record.
      </p>

      {/* A list rather than a table: at 390 a three-column table either forces a
          horizontal scroll container the width of its widest cell, or crushes
          the columns to unreadable. Each row becomes a stacked block on mobile
          and a 12-column row from `sm` up. */}
      <ul className="border-border mt-10 border-t">
        {ANCHORS.map((anchor) => {
          const seps = SEP_ORDER.filter((s) => anchor.seps?.includes(s));
          const quotes = seps.includes('sep38');
          return (
            <li
              key={anchor.id}
              className="border-border grid grid-cols-1 gap-x-6 gap-y-3 border-b py-5 sm:grid-cols-12 sm:items-baseline"
            >
              <div className="sm:col-span-4">
                <p className="text-sm font-medium">{anchor.name}</p>
                <p className="text-fg-muted mt-1 font-mono text-xs break-all">
                  {anchor.homeDomain}
                </p>
              </div>

              <div className="sm:col-span-4">
                <span className="text-fg-muted font-mono text-xs tracking-wide sm:sr-only">
                  corridors&nbsp;
                </span>
                <span className="text-secondary-text font-mono text-xs">
                  {anchor.corridors.map(corridorLabel).join(' · ')}
                </span>
              </div>

              <div className="sm:col-span-4">
                <span className="text-secondary-text font-mono text-xs">
                  {seps.map((s) => s.replace('sep', 'SEP-')).join(' ')}
                </span>
                {quotes ? (
                  /* The one accent in this section. */
                  <span className="text-accent mt-1 block font-mono text-xs">quote server</span>
                ) : (
                  <span className="text-fg-muted mt-1 block font-mono text-xs">
                    no quote server
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Link
        href="/anchors"
        className="text-secondary-text hover:text-primary-text focus-visible:ring-accent focus-visible:ring-offset-background mt-6 inline-flex h-11 items-center rounded-sm font-mono text-xs tracking-wide underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        open the health record &rarr;
      </Link>
    </section>
  );
}
