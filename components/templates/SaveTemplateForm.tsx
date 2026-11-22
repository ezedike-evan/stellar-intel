'use client';

import React, { useState } from 'react';
import type { IntentTemplateDraft, IntentTemplateInput } from '@/lib/templates/schema';
import { templateCorridorLabel } from '@/lib/templates/schema';
import type { SaveTemplateResult, TemplateStoreError } from '@/lib/templates/store';

export interface SaveTemplateFormProps {
  draft: IntentTemplateDraft;
  onSave: (input: IntentTemplateInput) => SaveTemplateResult;
  onDismiss: () => void;
}

export function templateErrorMessage(
  result:
    | { ok: false; error: TemplateStoreError; message?: string }
    | { message?: string }
    | TemplateStoreError
    | string
): string {
  if (typeof result === 'string') {
    switch (result) {
      case 'duplicate_label':
        return 'A template with this name already exists.';
      case 'limit':
        return 'You have 50 templates. Delete one to save another.';
      case 'storage_unavailable':
        return "This browser is blocking storage, so templates can't be saved here.";
      case 'not_found':
        return 'Template not found.';
      default:
        return result || 'Invalid template input.';
    }
  }
  if (typeof result === 'object' && result !== null) {
    if ('error' in result && typeof result.error === 'string') {
      switch (result.error) {
        case 'duplicate_label':
          return result.message || 'A template with this name already exists.';
        case 'limit':
          return result.message || 'You have 50 templates. Delete one to save another.';
        case 'storage_unavailable':
          return (
            result.message ||
            "This browser is blocking storage, so templates can't be saved here."
          );
        case 'not_found':
        case 'invalid':
          return result.message || 'Invalid template input.';
        default:
          return result.message || 'Invalid template input.';
      }
    }
    if ('message' in result && result.message) {
      return result.message;
    }
  }
  return 'Invalid template input.';
}

export function SaveTemplateForm({ draft, onSave, onDismiss }: SaveTemplateFormProps): React.ReactElement {
  const defaultLabel = `${templateCorridorLabel(draft.corridorId)} ${draft.amount}`;
  const [label, setLabel] = useState<string>(defaultLabel);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (savedLabel !== null) {
    return <p role="status">Saved as &quot;{savedLabel}&quot;.</p>;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = onSave({ ...draft, label } as IntentTemplateInput);
    if (result.ok) {
      setErrorMessage(null);
      setSavedLabel(label);
    } else {
      let msg = result.message;
      if (result.error === 'limit') {
        msg = 'You have 50 templates. Delete one to save another.';
      } else if (result.error === 'duplicate_label') {
        msg = 'A template with this name already exists.';
      } else if (result.error === 'storage_unavailable') {
        msg = "This browser is blocking storage, so templates can't be saved here.";
      }
      setErrorMessage(msg);
    }
  };

  return (
    <section
      aria-labelledby="save-template-heading"
      className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h3
        id="save-template-heading"
        className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
      >
        Save this as a template?
      </h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {draft.amount} {templateCorridorLabel(draft.corridorId)}
      </p>

      <form onSubmit={handleSubmit} className="mt-3 space-y-3">
        <div>
          <label
            htmlFor="template-label"
            className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            Template name
          </label>
          <input
            id="template-label"
            type="text"
            maxLength={60}
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            aria-invalid={errorMessage ? 'true' : undefined}
            aria-describedby={errorMessage ? 'template-label-error' : undefined}
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
          {errorMessage && (
            <p
              role="alert"
              id="template-label-error"
              className="mt-1 text-xs text-red-600 dark:text-red-400"
            >
              {errorMessage}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none"
          >
            Save template
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Not now
          </button>
        </div>
      </form>
    </section>
  );
}
