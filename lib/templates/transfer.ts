/**
 * lib/templates/transfer.ts
 *
 * Export a wallet's intent templates as a JSON file and import one back
 * (TPL003). An imported file can only add entries that pass
 * IntentTemplateSchema, and error messages never echo the file's content.
 */
import { STELLAR_PUBKEY_PATTERN } from '@/lib/patterns';
import {
  IntentTemplateExportSchema,
  MAX_TEMPLATES_PER_WALLET,
  TEMPLATE_EXPORT_FORMAT,
  type IntentTemplate,
  type IntentTemplateExport,
} from './schema';
import { readTemplates, writeTemplates, type TemplateStoreError } from './store';

export const MAX_IMPORT_BYTES = 100_000;

export type ImportMode = 'merge' | 'replace';

export interface ImportSummary {
  added: number;
  updated: number;
  skipped: number;
}

export type ParseImportResult =
  { ok: true; templates: IntentTemplate[] } | { ok: false; error: string };

export function buildTemplateExport(
  templates: readonly IntentTemplate[],
  now: Date = new Date()
): IntentTemplateExport {
  return {
    format: TEMPLATE_EXPORT_FORMAT,
    version: 1,
    exportedAt: now.toISOString(),
    templates: [...templates],
  };
}

export function serializeTemplateExport(exp: IntentTemplateExport): string {
  return JSON.stringify(exp, null, 2);
}

export function parseTemplateImport(text: string): ParseImportResult {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'File is too large.' };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }

  const parsed = IntentTemplateExportSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'This is not a Stellar Intel templates file.' };
  }
  return { ok: true, templates: parsed.data.templates };
}

function sameLabel(a: IntentTemplate, b: IntentTemplate): boolean {
  return (
    a.direction === b.direction && a.label.trim().toLowerCase() === b.label.trim().toLowerCase()
  );
}

/**
 * Merges imported templates into the wallet's (a newer copy of the same id
 * wins; a clashing label or the 50-template cap skips), or replaces them.
 */
export function importTemplates(
  publicKey: string,
  templates: readonly IntentTemplate[],
  mode: ImportMode
): { ok: true; summary: ImportSummary } | { ok: false; error: TemplateStoreError } {
  if (!STELLAR_PUBKEY_PATTERN.test(publicKey)) return { ok: false, error: 'invalid' };

  if (mode === 'replace') {
    if (!writeTemplates(publicKey, [...templates])) {
      return { ok: false, error: 'storage_unavailable' };
    }
    return { ok: true, summary: { added: templates.length, updated: 0, skipped: 0 } };
  }

  const merged = readTemplates(publicKey);
  const summary: ImportSummary = { added: 0, updated: 0, skipped: 0 };

  for (const incoming of templates) {
    const index = merged.findIndex((t) => t.id === incoming.id);
    const current = index === -1 ? undefined : merged[index];
    if (current) {
      if (incoming.updatedAt > current.updatedAt) {
        merged[index] = incoming;
        summary.updated += 1;
      } else {
        summary.skipped += 1;
      }
      continue;
    }
    if (merged.length >= MAX_TEMPLATES_PER_WALLET || merged.some((t) => sameLabel(t, incoming))) {
      summary.skipped += 1;
      continue;
    }
    merged.push(incoming);
    summary.added += 1;
  }

  if (!writeTemplates(publicKey, merged)) return { ok: false, error: 'storage_unavailable' };
  return { ok: true, summary };
}

export function templateExportFilename(now: Date = new Date()): string {
  return `stellar-intel-templates-${now.toISOString().slice(0, 10)}.json`;
}
