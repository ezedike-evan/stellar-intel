import { STELLAR_PUBKEY_PATTERN } from '@/lib/patterns';
import {
  type IntentTemplate,
  type IntentTemplateExport,
  IntentTemplateExportSchema,
  MAX_TEMPLATES_PER_WALLET,
  TEMPLATE_EXPORT_FORMAT,
} from './schema';
import {
  type TemplateStoreError,
  readTemplates,
  writeTemplates,
} from './store';

export const MAX_IMPORT_BYTES = 100_000;
export type ImportMode = 'merge' | 'replace';
export interface ImportSummary {
  added: number;
  updated: number;
  skipped: number;
}

export function buildTemplateExport(
  templates: readonly IntentTemplate[],
  now = new Date()
): IntentTemplateExport {
  return {
    format: TEMPLATE_EXPORT_FORMAT,
    version: 1,
    exportedAt: now.toISOString(),
    templates: templates.slice(0, MAX_TEMPLATES_PER_WALLET) as IntentTemplate[],
  };
}

export function serializeTemplateExport(exp: IntentTemplateExport): string {
  return JSON.stringify(exp, null, 2);
}

export type ParseImportResult =
  | { ok: true; templates: IntentTemplate[] }
  | { ok: false; error: string };

export function parseTemplateImport(text: string): ParseImportResult {
  if (text.length > MAX_IMPORT_BYTES) {
    return { ok: false, error: 'File is too large.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  const res = IntentTemplateExportSchema.safeParse(parsed);
  if (!res.success) {
    return { ok: false, error: 'This is not a Stellar Intel templates file.' };
  }
  return { ok: true, templates: res.data.templates };
}

export function importTemplates(
  publicKey: string,
  incoming: readonly IntentTemplate[],
  mode: ImportMode
): { ok: true; summary: ImportSummary } | { ok: false; error: TemplateStoreError } {
  if (!STELLAR_PUBKEY_PATTERN.test(publicKey)) {
    return { ok: false, error: 'invalid' };
  }

  if (mode === 'replace') {
    const capped = incoming.slice(0, MAX_TEMPLATES_PER_WALLET);
    const ok = writeTemplates(publicKey, capped as IntentTemplate[]);
    if (!ok) return { ok: false, error: 'storage_unavailable' };
    return { ok: true, summary: { added: capped.length, updated: 0, skipped: 0 } };
  }

  // mode === 'merge'
  const existing = readTemplates(publicKey);
  const resultList = [...existing];
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const t of incoming) {
    const existingIndex = resultList.findIndex((item) => item.id === t.id);
    if (existingIndex !== -1) {
      const existingItem = resultList[existingIndex];
      if (!existingItem) {
        skipped++;
        continue;
      }
      const incomingTime = new Date(t.updatedAt).getTime();
      const existingTime = new Date(existingItem.updatedAt).getTime();
      if (incomingTime > existingTime) {
        resultList[existingIndex] = t;
        updated++;
      } else {
        skipped++;
      }
    } else {
      // New item
      if (resultList.length >= MAX_TEMPLATES_PER_WALLET) {
        skipped++;
        continue;
      }
      const duplicateLabel = resultList.some(
        (item) =>
          item.direction === t.direction &&
          item.label.trim().toLowerCase() === t.label.trim().toLowerCase()
      );
      if (duplicateLabel) {
        skipped++;
        continue;
      }
      resultList.push(t);
      added++;
    }
  }

  const ok = writeTemplates(publicKey, resultList);
  if (!ok) return { ok: false, error: 'storage_unavailable' };
  return { ok: true, summary: { added, updated, skipped } };
}

export function templateExportFilename(now = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `stellar-intel-templates-${yyyy}-${mm}-${dd}.json`;
}
