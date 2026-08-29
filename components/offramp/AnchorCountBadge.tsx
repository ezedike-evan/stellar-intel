interface AnchorCountBadgeProps {
  responding: number;
  total: number;
}

/**
 * "X of Y anchors responding" — the accent when all respond, amber when partial,
 * red at zero.
 *
 * This is one of the few places the accent is genuinely earned: every anchor
 * answering is the good outcome the whole record exists to observe.
 */
export function AnchorCountBadge({ responding, total }: AnchorCountBadgeProps) {
  if (total === 0) return null;

  const colorClass =
    responding === total
      ? 'bg-accent-subtle text-status-up'
      : responding === 0
        ? 'bg-bg-sunken text-status-down'
        : 'bg-bg-sunken text-status-unknown';

  return (
    <span
      className={`inline-flex items-center rounded-sm px-2 py-0.5 font-mono text-xs font-medium tracking-wide whitespace-nowrap ${colorClass}`}
    >
      {responding} of {total} anchors responding
    </span>
  );
}
