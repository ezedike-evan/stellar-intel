'use client';

import type { Ref } from 'react';
import { ANCHORS } from '@/constants/anchors';
import { templateCorridorLabel, type IntentTemplate } from '@/lib/templates/schema';

export interface TemplatePickerProps {
  templates: IntentTemplate[];
  visibleCorridorIds: ReadonlySet<string>;
  onApply: (template: IntentTemplate) => void;
  onManage?: () => void;
  manageButtonRef?: Ref<HTMLButtonElement>;
}

const CONTROL =
  'border-border bg-bg-base text-primary-text focus-visible:ring-accent rounded-lg border px-3 py-2 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none';

function optionText(template: IntentTemplate, available: boolean): string {
  const anchor = template.anchorId ? ANCHORS.find((a) => a.id === template.anchorId) : undefined;
  return (
    `${template.label} — ${template.amount} ${templateCorridorLabel(template.corridorId)}` +
    (anchor ? ` · ${anchor.name}` : '') +
    (available ? '' : ' (corridor unavailable)')
  );
}

/**
 * Saved intent templates as a native select (TPL006), so keyboard and screen
 * reader support come with the control. Choosing one applies it and resets
 * the select, so the same template can be applied again.
 */
export function TemplatePicker({
  templates,
  visibleCorridorIds,
  onApply,
  onManage,
  manageButtonRef,
}: TemplatePickerProps) {
  if (templates.length === 0 && !onManage) return null;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <label htmlFor="template-select" className="text-fg-muted mb-1 block text-xs font-medium">
          Saved templates
        </label>
        <select
          id="template-select"
          value=""
          onChange={(event) => {
            const template = templates.find((t) => t.id === event.target.value);
            event.target.value = '';
            if (template) onApply(template);
          }}
          className={`${CONTROL} w-full`}
        >
          <option value="">Choose a template…</option>
          {templates.map((template) => {
            const available = visibleCorridorIds.has(template.corridorId);
            return (
              <option key={template.id} value={template.id} disabled={!available}>
                {optionText(template, available)}
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
          className={`${CONTROL} hover:bg-bg-subtle active:translate-y-px`}
        >
          Manage templates
        </button>
      )}
    </div>
  );
}
