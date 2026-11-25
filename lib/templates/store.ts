/**
 * lib/templates/store.ts
 *
 * Intent templates kept in localStorage, one array per wallet (TPL002). Client
 * safe: it imports only the template schema and the key pattern.
 *
 * Every storage call sits inside try/catch, as in lib/consent.ts: private mode,
 * disabled storage or a full quota degrade to "no templates" or a typed error,
 * and nothing in this module throws. Entries are re-validated on every read,
 * so a hand-edited or stale entry is dropped instead of reaching the UI.
 */
import { STELLAR_PUBKEY_PATTERN } from '@/lib/patterns';
import {
  IntentTemplateInputSchema,
  IntentTemplateSchema,
  MAX_TEMPLATES_PER_WALLET,
  TEMPLATE_SCHEMA_VERSION,
  type IntentTemplate,
  type IntentTemplateInput,
  type TemplateDirection,
} from './schema';

export const TEMPLATE_STORAGE_PREFIX = 'intent-templates:v1';
const PROBE_KEY = '__intent_templates_probe__';

export function templateStorageKey(publicKey: string): string {
  return `${TEMPLATE_STORAGE_PREFIX}:${publicKey}`;
}

export type TemplateStoreError =
  'invalid' | 'limit' | 'duplicate_label' | 'not_found' | 'storage_unavailable';

export type SaveTemplateResult =
  | { ok: true; template: IntentTemplate }
  | { ok: false; error: TemplateStoreError; message: string };

export interface TemplatePatch {
  label?: string;
  amount?: string;
}

function validKey(publicKey: string): boolean {
  return STELLAR_PUBKEY_PATTERN.test(publicKey);
}

function fail(error: TemplateStoreError, message: string): SaveTemplateResult {
  return { ok: false, error, message };
}

function sameLabel(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function isTemplateStorageAvailable(): boolean {
  try {
    localStorage.setItem(PROBE_KEY, '1');
    localStorage.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** The wallet's stored templates, unsorted; invalid entries are dropped silently. */
export function readTemplates(publicKey: string): IntentTemplate[] {
  if (!validKey(publicKey)) return [];
  let raw: string | null;
  try {
    raw = localStorage.getItem(templateStorageKey(publicKey));
  } catch {
    return [];
  }
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const templates: IntentTemplate[] = [];
  for (const entry of parsed) {
    const result = IntentTemplateSchema.safeParse(entry);
    if (result.success) templates.push(result.data);
  }
  return templates;
}

/** Writes the wallet's templates; false on any storage failure (quota, disabled storage). */
export function writeTemplates(publicKey: string, templates: IntentTemplate[]): boolean {
  if (!validKey(publicKey)) return false;
  try {
    localStorage.setItem(templateStorageKey(publicKey), JSON.stringify(templates));
    return true;
  } catch {
    return false;
  }
}

/** Most recently used (or updated) first; ties by label. */
export function listTemplates(publicKey: string, direction?: TemplateDirection): IntentTemplate[] {
  return readTemplates(publicKey)
    .filter((t) => direction === undefined || t.direction === direction)
    .sort((a, b) => {
      const byTime = (b.lastUsedAt ?? b.updatedAt).localeCompare(a.lastUsedAt ?? a.updatedAt);
      return byTime !== 0 ? byTime : a.label.localeCompare(b.label);
    });
}

export function saveTemplate(
  publicKey: string,
  input: IntentTemplateInput,
  now: Date = new Date()
): SaveTemplateResult {
  if (!validKey(publicKey)) return fail('invalid', 'Connect a valid Stellar wallet first');

  const parsed = IntentTemplateInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail('invalid', parsed.error.issues[0]?.message ?? 'Template is not valid');
  }

  const existing = readTemplates(publicKey);
  if (existing.length >= MAX_TEMPLATES_PER_WALLET) {
    return fail('limit', `You can keep up to ${MAX_TEMPLATES_PER_WALLET} templates`);
  }
  if (
    existing.some(
      (t) => t.direction === parsed.data.direction && sameLabel(t.label, parsed.data.label)
    )
  ) {
    return fail('duplicate_label', 'You already have a template with that name');
  }

  const stamp = now.toISOString();
  const candidate = IntentTemplateSchema.safeParse({
    ...parsed.data,
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    id: globalThis.crypto.randomUUID(),
    createdAt: stamp,
    updatedAt: stamp,
  });
  if (!candidate.success) {
    return fail('invalid', candidate.error.issues[0]?.message ?? 'Template is not valid');
  }

  if (!writeTemplates(publicKey, [...existing, candidate.data])) {
    return fail('storage_unavailable', 'Templates could not be saved in this browser');
  }
  return { ok: true, template: candidate.data };
}

export function updateTemplate(
  publicKey: string,
  id: string,
  patch: TemplatePatch,
  now: Date = new Date()
): SaveTemplateResult {
  if (!validKey(publicKey)) return fail('invalid', 'Connect a valid Stellar wallet first');

  const existing = readTemplates(publicKey);
  const index = existing.findIndex((t) => t.id === id);
  const current = index === -1 ? undefined : existing[index];
  if (!current) return fail('not_found', 'That template no longer exists');

  const next = IntentTemplateSchema.safeParse({
    ...current,
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
    updatedAt: now.toISOString(),
  });
  if (!next.success) {
    return fail('invalid', next.error.issues[0]?.message ?? 'Template is not valid');
  }
  if (
    existing.some(
      (t) =>
        t.id !== id && t.direction === next.data.direction && sameLabel(t.label, next.data.label)
    )
  ) {
    return fail('duplicate_label', 'You already have a template with that name');
  }

  const updated = [...existing];
  updated[index] = next.data;
  if (!writeTemplates(publicKey, updated)) {
    return fail('storage_unavailable', 'Templates could not be saved in this browser');
  }
  return { ok: true, template: next.data };
}

/** True only when a template was removed and the result written. */
export function deleteTemplate(publicKey: string, id: string): boolean {
  const existing = readTemplates(publicKey);
  const remaining = existing.filter((t) => t.id !== id);
  if (remaining.length === existing.length) return false;
  return writeTemplates(publicKey, remaining);
}

/** Records that a template was just applied. Silent on any failure. */
export function markTemplateUsed(publicKey: string, id: string, now: Date = new Date()): void {
  const existing = readTemplates(publicKey);
  const index = existing.findIndex((t) => t.id === id);
  const current = index === -1 ? undefined : existing[index];
  if (!current) return;
  const updated = [...existing];
  updated[index] = { ...current, lastUsedAt: now.toISOString() };
  writeTemplates(publicKey, updated);
}

export function clearTemplates(publicKey: string): void {
  if (!validKey(publicKey)) return;
  try {
    localStorage.removeItem(templateStorageKey(publicKey));
  } catch {
    // Storage unavailable: nothing to clear.
  }
}
