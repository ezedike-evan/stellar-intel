import { useCallback, useEffect, useState } from 'react';
import { TEMPLATE_EVENTS, amountBucket, trackFunnelEvent } from '@/lib/analytics';
import type {
  IntentTemplate,
  IntentTemplateInput,
  TemplateDirection,
} from '@/lib/templates/schema';
import {
  deleteTemplate,
  isTemplateStorageAvailable,
  listTemplates,
  markTemplateUsed,
  readTemplates,
  saveTemplate,
  templateStorageKey,
  updateTemplate,
  type SaveTemplateResult,
  type TemplateStoreError,
} from '@/lib/templates/store';
import {
  buildTemplateExport,
  importTemplates,
  parseTemplateImport,
  serializeTemplateExport,
  type ImportMode,
  type ImportSummary,
} from '@/lib/templates/transfer';

export interface UseIntentTemplatesResult {
  templates: IntentTemplate[];
  storageAvailable: boolean;
  save(input: IntentTemplateInput): SaveTemplateResult;
  rename(id: string, label: string): SaveTemplateResult;
  updateAmount(id: string, amount: string): SaveTemplateResult;
  remove(id: string): boolean;
  markUsed(id: string): void;
  exportJson(): string;
  importJson(
    text: string,
    mode: ImportMode
  ): { ok: true; summary: ImportSummary } | { ok: false; error: string };
}

const NO_WALLET: SaveTemplateResult = {
  ok: false,
  error: 'invalid',
  message: 'Connect a wallet to use templates.',
};

const STORE_ERROR_MESSAGES: Record<TemplateStoreError, string> = {
  invalid: 'Connect a wallet to use templates.',
  limit: 'You already have the maximum number of templates.',
  duplicate_label: 'You already have a template with that name.',
  not_found: 'That template no longer exists.',
  storage_unavailable: 'Templates could not be saved in this browser.',
};

/** Single-template analytics props: never the label, id or raw amount. */
function templateProps(template: IntentTemplate) {
  return {
    direction: template.direction,
    corridor: template.corridorId,
    amount_bucket: amountBucket(template.amount),
  };
}

/**
 * The connected wallet's intent templates for one direction (TPL005), so pages
 * never touch lib/templates/store directly. Reads happen in an effect, so the
 * server render (and the first client render) sees no templates.
 */
export function useIntentTemplates(
  publicKey: string | null,
  direction: TemplateDirection
): UseIntentTemplatesResult {
  const [templates, setTemplates] = useState<IntentTemplate[]>([]);
  const [storageAvailable, setStorageAvailable] = useState(true);

  const refresh = useCallback(() => {
    setTemplates(publicKey ? listTemplates(publicKey, direction) : []);
  }, [publicKey, direction]);

  useEffect(() => {
    setStorageAvailable(isTemplateStorageAvailable());
    refresh();
  }, [refresh]);

  // Another tab saving or deleting a template updates this one too.
  useEffect(() => {
    if (!publicKey) return;
    const key = templateStorageKey(publicKey);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [publicKey, refresh]);

  const save = useCallback(
    (input: IntentTemplateInput): SaveTemplateResult => {
      if (!publicKey) return NO_WALLET;
      const result = saveTemplate(publicKey, input);
      if (result.ok) {
        refresh();
        trackFunnelEvent(TEMPLATE_EVENTS.templateSaved, templateProps(result.template));
      }
      return result;
    },
    [publicKey, refresh]
  );

  const update = useCallback(
    (id: string, patch: { label?: string; amount?: string }): SaveTemplateResult => {
      if (!publicKey) return NO_WALLET;
      const result = updateTemplate(publicKey, id, patch);
      if (result.ok) {
        refresh();
        trackFunnelEvent(TEMPLATE_EVENTS.templateUpdated, templateProps(result.template));
      }
      return result;
    },
    [publicKey, refresh]
  );

  const rename = useCallback((id: string, label: string) => update(id, { label }), [update]);
  const updateAmount = useCallback(
    (id: string, amount: string) => update(id, { amount }),
    [update]
  );

  const remove = useCallback(
    (id: string): boolean => {
      if (!publicKey) return false;
      const template = readTemplates(publicKey).find((t) => t.id === id);
      const removed = deleteTemplate(publicKey, id);
      if (removed) {
        refresh();
        if (template) trackFunnelEvent(TEMPLATE_EVENTS.templateDeleted, templateProps(template));
      }
      return removed;
    },
    [publicKey, refresh]
  );

  const markUsed = useCallback(
    (id: string): void => {
      if (!publicKey) return;
      markTemplateUsed(publicKey, id);
      refresh();
    },
    [publicKey, refresh]
  );

  const exportJson = useCallback((): string => {
    const all = publicKey ? readTemplates(publicKey) : [];
    trackFunnelEvent(TEMPLATE_EVENTS.templatesExported, { direction });
    return serializeTemplateExport(buildTemplateExport(all));
  }, [publicKey, direction]);

  const importJson = useCallback(
    (text: string, mode: ImportMode) => {
      if (!publicKey) return { ok: false as const, error: STORE_ERROR_MESSAGES.invalid };
      const parsed = parseTemplateImport(text);
      if (!parsed.ok) return parsed;
      const result = importTemplates(publicKey, parsed.templates, mode);
      if (!result.ok) return { ok: false as const, error: STORE_ERROR_MESSAGES[result.error] };
      refresh();
      trackFunnelEvent(TEMPLATE_EVENTS.templatesImported, { direction });
      return result;
    },
    [publicKey, direction, refresh]
  );

  return {
    templates,
    storageAvailable,
    save,
    rename,
    updateAmount,
    remove,
    markUsed,
    exportJson,
    importJson,
  };
}
