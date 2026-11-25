import React from 'react';
import { ANCHORS } from '@/constants/anchors';
import { DISPUTE_CATEGORY_LABELS, DISPUTE_LEVEL_LABELS } from '@/lib/reputation/dispute-ladder';
import type { AdjudicationEntry } from '@/lib/reputation/adjudication-log';

export interface DisputeLogTableProps {
  entries: AdjudicationEntry[];
}

export function DisputeLogTable({ entries }: DisputeLogTableProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-subtle p-8 text-center text-sm text-secondary-text">
        No disputes have been filed yet.
      </div>
    );
  }

  // Sort newest first by sequence descending
  const sorted = [...entries].sort((a, b) => b.seq - a.seq);

  return (
    <div className="space-y-4">
      {/* Mobile view (< sm): stacked cards */}
      <div className="space-y-3 sm:hidden" data-testid="dispute-log-mobile">
        {sorted.map((entry) => {
          const anchor = ANCHORS.find((a) => a.id === entry.anchorId);
          const anchorName = anchor ? anchor.name : entry.anchorId;
          const categoryLabel = DISPUTE_CATEGORY_LABELS[entry.category] ?? entry.category;
          const levelLabel = DISPUTE_LEVEL_LABELS[entry.level] ?? entry.level;
          const rationale = entry.rationale.trim() ? entry.rationale : '—';
          const truncatedHash = entry.entryHash.slice(0, 12);

          return (
            <div
              key={entry.entryHash}
              className="rounded-lg border border-border bg-bg-subtle p-4 text-xs space-y-2 text-primary-text"
            >
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="font-semibold">{anchorName}</span>
                <span className="text-secondary-text">{entry.decidedAt}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-secondary-text">
                <div>
                  <span className="text-fg-muted">Category:</span> {categoryLabel}
                </div>
                <div>
                  <span className="text-fg-muted">Level:</span> {levelLabel}
                </div>
                <div>
                  <span className="text-fg-muted">Action:</span>{' '}
                  <span className="capitalize font-medium text-primary-text">{entry.action}</span>
                </div>
                <div>
                  <span className="text-fg-muted">Hash:</span>{' '}
                  <span title={entry.entryHash} className="font-mono">
                    {truncatedHash}
                  </span>
                </div>
              </div>
              <div className="pt-1">
                <span className="text-fg-muted">Rationale:</span>{' '}
                <span className="italic">{rationale}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop view (>= sm): structured table */}
      <div className="hidden sm:block overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-xs text-primary-text">
          <thead className="border-b border-border bg-bg-subtle text-secondary-text">
            <tr>
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold">Anchor</th>
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold">Level</th>
              <th className="px-4 py-3 font-semibold">Action</th>
              <th className="px-4 py-3 font-semibold">Rationale</th>
              <th className="px-4 py-3 font-semibold">Entry Hash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {sorted.map((entry) => {
              const anchor = ANCHORS.find((a) => a.id === entry.anchorId);
              const anchorName = anchor ? anchor.name : entry.anchorId;
              const categoryLabel = DISPUTE_CATEGORY_LABELS[entry.category] ?? entry.category;
              const levelLabel = DISPUTE_LEVEL_LABELS[entry.level] ?? entry.level;
              const rationale = entry.rationale.trim() ? entry.rationale : '—';
              const truncatedHash = entry.entryHash.slice(0, 12);

              return (
                <tr key={entry.entryHash} className="hover:bg-bg-subtle/50 transition-colors">
                  <td className="whitespace-nowrap px-4 py-3 text-secondary-text">
                    {entry.decidedAt}
                  </td>
                  <td className="px-4 py-3 font-medium">{anchorName}</td>
                  <td className="px-4 py-3 text-secondary-text">{categoryLabel}</td>
                  <td className="px-4 py-3 text-secondary-text">{levelLabel}</td>
                  <td className="px-4 py-3 font-medium capitalize">{entry.action}</td>
                  <td
                    className="px-4 py-3 max-w-xs truncate text-secondary-text"
                    title={entry.rationale}
                  >
                    {rationale}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono">
                    <span title={entry.entryHash}>{truncatedHash}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
