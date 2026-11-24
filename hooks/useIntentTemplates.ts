import { useCallback, useEffect, useState } from 'react';
import { trackFunnelEvent, amountBucket, TEMPLATE_EVENTS } from '@/lib/analytics';
import type {
  IntentTemplate,
  IntentTemplateInput,
  TemplateDirection,
} from '@/lib/templates/schema';
import {
  type ImportMode,
  type ImportSummary,
  buildTemplateExport,
  importTemplates,
  parseTemplateImport,
  serializeTemplateExport,
} from '@/lib/templates/transfer';
import {
  type SaveTemplateResult,
  deleteTemplate,
  isTemplateStorageAvailable,
  listTemplates,
  markTemplateUsed,
  saveTemplate,
  templateStorageKey,
  updateTemplate,
} from '@/lib/templates/store';

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

export function useIntentTemplates(
  publicKey: string | null,
  direction: TemplateDirection
): UseIntentTemplatesResult {
  const [templates, setTemplates] = useState<IntentTemplate[]>([]);
  const [storageAvailable, setStorageAvailable] = useState<boolean>(false);

  const refresh = useCallback(() => {
    if (!publicKey) {
      setTemplates([]);
      return;
    }
    setTemplates(listTemplates(publicKey, direction));
  }, [publicKey, direction]);

  useEffect(() => {
    setStorageAvailable(isTemplateStorageAvailable());
    refresh();
  }, [publicKey, direction, refresh]);

  useEffect(() => {
    if (!publicKey || typeof window === 'undefined') return;
    const targetKey = templateStorageKey(publicKey);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === targetKey || event.key === null) {
        refresh();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, [publicKey, refresh]);

  const save = useCallback(
    (input: IntentTemplateInput): SaveTemplateResult => {
      if (!publicKey) {
        return { ok: false, error: 'invalid', message: 'Connect a wallet to use templates.' };
      }
      const res = saveTemplate(publicKey, input);
      if (res.ok) {
        refresh();
        trackFunnelEvent(TEMPLATE_EVENTS.templateSaved, {
          direction: res.template.direction,
          corridor: res.template.corridorId,
          amount_bucket: amountBucket(res.template.amount),
        });
      }
      return res;
    },
    [publicKey, refresh]
  );

  const rename = useCallback(
    (id: string, label: string): SaveTemplateResult => {
      if (!publicKey) {
        return { ok: false, error: 'invalid', message: 'Connect a wallet to use templates.' };
      }
      const res = updateTemplate(publicKey, id, { label });
      if (res.ok) {
        refresh();
        trackFunnelEvent(TEMPLATE_EVENTS.templateUpdated, {
          direction: res.template.direction,
          corridor: res.template.corridorId,
          amount_bucket: amountBucket(res.template.amount),
        });
      }
      return res;
    },
    [publicKey, refresh]
  );

  const updateAmount = useCallback(
    (id: string, amount: string): SaveTemplateResult => {
      if (!publicKey) {
        return { ok: false, error: 'invalid', message: 'Connect a wallet to use templates.' };
      }
      const res = updateTemplate(publicKey, id, { amount });
      if (res.ok) {
        refresh();
        trackFunnelEvent(TEMPLATE_EVENTS.templateUpdated, {
          direction: res.template.direction,
          corridor: res.template.corridorId,
          amount_bucket: amountBucket(res.template.amount),
        });
      }
      return res;
    },
    [publicKey, refresh]
  );

  const remove = useCallback(
    (id: string): boolean => {
      if (!publicKey) return false;
      const target = templates.find((t) => t.id === id);
      const ok = deleteTemplate(publicKey, id);
      if (ok) {
        refresh();
        if (target) {
          trackFunnelEvent(TEMPLATE_EVENTS.templateDeleted, {
            direction: target.direction,
            corridor: target.corridorId,
            amount_bucket: amountBucket(target.amount),
          });
        }
      }
      return ok;
    },
    [publicKey, templates, refresh]
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
    if (!publicKey) return '';
    const all = listTemplates(publicKey);
    trackFunnelEvent(TEMPLATE_EVENTS.templatesExported, {
      direction,
    });
    return serializeTemplateExport(buildTemplateExport(all));
  }, [publicKey, direction]);

  const importJson = useCallback(
    (
      text: string,
      mode: ImportMode
    ): { ok: true; summary: ImportSummary } | { ok: false; error: string } => {
      if (!publicKey) {
        return { ok: false, error: 'Connect a wallet to use templates.' };
      }
      const parsed = parseTemplateImport(text);
      if (!parsed.ok) {
        return { ok: false, error: parsed.error };
      }
      const res = importTemplates(publicKey, parsed.templates, mode);
      if (!res.ok) {
        const errorMessages: Record<string, string> = {
          invalid: 'Invalid Stellar public key.',
          storage_unavailable: 'Storage unavailable or quota exceeded.',
        };
        return { ok: false, error: errorMessages[res.error] ?? 'Import failed.' };
      }
      refresh();
      trackFunnelEvent(TEMPLATE_EVENTS.templatesImported, {
        direction,
      });
      return { ok: true, summary: res.summary };
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
