import { ANCHORS } from '@/constants';
import { AnchorLogo } from '@/components/ui/AnchorLogo';

/**
 * Landing logo wall of every registered anchor. Logos render grayscale by
 * default and pick up full color on hover/focus, echoing the wall pattern
 * used by most fintech landing pages without implying any one anchor is
 * "featured" over another.
 */
export function LogoWall() {
  return (
    <section aria-label="Supported anchors">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Supported anchors
      </p>
      <ul className="flex flex-wrap items-center gap-x-8 gap-y-5">
        {ANCHORS.map((anchor) => (
          <li key={anchor.id}>
            <div
              tabIndex={0}
              className="group flex items-center gap-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="grayscale opacity-70 transition-all duration-200 group-hover:grayscale-0 group-hover:opacity-100 group-focus-visible:grayscale-0 group-focus-visible:opacity-100">
                <AnchorLogo anchorId={anchor.id} anchorName={anchor.name} size="sm" />
              </span>
              <span className="text-sm font-medium text-fg-muted transition-colors duration-200 group-hover:text-primary-text dark:text-fg-muted dark:group-hover:text-white">
                {anchor.name}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
