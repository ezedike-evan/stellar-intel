'use client';

import React, { useCallback } from 'react';
import type { IntentTemplate } from '@/lib/templates/schema';
import { templateCorridorLabel } from '@/lib/templates/schema';
import { ANCHORS } from '@/constants/anchors';

export interface TemplatePickerProps {
  templates: IntentTemplate[];
  visibleCorridorIds: ReadonlySet<string>;
  onApply: (template: IntentTemplate) => void;
  onManage?: () => void;
  manageButtonRef?: React.Ref<HTMLButtonElement>;
}

const ANCHOR_MAP = new Map(ANCHORS.map((a) => [a.id, a.name]));

export function TemplatePicker({
  templates,
  visibleCorridorIds,
  onApply,
  onManage,
  manageButtonRef,
}: TemplatePickerProps): React.ReactElement | null {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const selectedId = e.target.value;
      if (!selectedId) return;
      const t = templates.find((item) => item.id === selectedId);
      if (t) {
        onApply(t);
      }
      e.target.value = '';
    },
    [templates, onApply]
  );

  if (templates.length === 0 && !onManage) {
    return null;
  }

  return (
    <div className="border-border bg-bg-sunken flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
      <div className="flex min-w-[200px] flex-1 items-center gap-3">
        <label htmlFor="template-select" className="text-fg-muted whitespace-nowrap text-xs font-medium">
          Saved templates
        </label>
        <select
          id="template-select"
          defaultValue=""
          onChange={handleChange}
          className="border-border bg-bg-base text-primary-text focus-visible:ring-accent max-w-md flex-1 rounded-lg border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <option value="">Choose a template…</option>
          {templates.map((t) => {
            const available = visibleCorridorIds.has(t.corridorId);
            const anchorName = t.anchorId ? ANCHOR_MAP.get(t.anchorId) : undefined;
            const anchorPart = anchorName ? ` · ${anchorName}` : '';
            const suffix = available ? '' : ' (corridor unavailable)';
            const optionText = `${t.label} — ${t.amount} ${templateCorridorLabel(t.corridorId)}${anchorPart}${suffix}`;

            return (
              <option key={t.id} value={t.id} disabled={!available}>
                {optionText}
              </option>
            );
          })}
        </select>
      </div>
      {onManage && (
        <button
          type="button"
          ref={manageButtonRef}
          onClick={onManage}
          className="text-primary-text hover:text-accent whitespace-nowrap text-xs font-medium underline-offset-4 hover:underline"
        >
          Manage templates
        </button>
      )}
    </div>
  );
}
