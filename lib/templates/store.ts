import { STELLAR_PUBKEY_PATTERN } from '@/lib/patterns';
import {
  type IntentTemplate,
  type IntentTemplateInput,
  type TemplateDirection,
  IntentTemplateSchema,
  IntentTemplateInputSchema,
  MAX_TEMPLATES_PER_WALLET,
} from './schema';

export const TEMPLATE_STORAGE_PREFIX = 'intent-templates:v1';

export function templateStorageKey(publicKey: string): string {
  return `${TEMPLATE_STORAGE_PREFIX}:${publicKey}`;
}

export type TemplateStoreError =
  | 'invalid'
  | 'limit'
  | 'duplicate_label'
  | 'not_found'
  | 'storage_unavailable';

export type SaveTemplateResult =
  | { ok: true; template: IntentTemplate }
  | { ok: false; error: TemplateStoreError; message: string };

export interface TemplatePatch {
  label?: string;
  amount?: string;
}

export function isTemplateStorageAvailable(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    const probe = '__intent_templates_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function readTemplates(publicKey: string): IntentTemplate[] {
  if (!STELLAR_PUBKEY_PATTERN.test(publicKey)) return [];
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(templateStorageKey(publicKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: IntentTemplate[] = [];
    for (const item of parsed) {
      const res = IntentTemplateSchema.safeParse(item);
      if (res.success) {
        valid.push(res.data);
      }
    }
    return valid;
  } catch {
    return [];
  }
}

export function writeTemplates(publicKey: string, templates: IntentTemplate[]): boolean {
  if (!STELLAR_PUBKEY_PATTERN.test(publicKey)) return false;
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    window.localStorage.setItem(templateStorageKey(publicKey), JSON.stringify(templates));
    return true;
  } catch {
    return false;
  }
}

export function listTemplates(publicKey: string, direction?: TemplateDirection): IntentTemplate[] {
  const all = readTemplates(publicKey);
  const filtered = direction ? all.filter((t) => t.direction === direction) : all;
  return filtered.sort((a, b) => {
    const timeA = new Date(a.lastUsedAt ?? a.updatedAt).getTime();
    const timeB = new Date(b.lastUsedAt ?? b.updatedAt).getTime();
    if (timeB !== timeA) return timeB - timeA;
    return a.label.localeCompare(b.label);
  });
}

export function saveTemplate(
  publicKey: string,
  input: IntentTemplateInput,
  now = new Date()
): SaveTemplateResult {
  if (!STELLAR_PUBKEY_PATTERN.test(publicKey)) {
    return { ok: false, error: 'invalid', message: 'Invalid Stellar public key.' };
  }
  const parseRes = IntentTemplateInputSchema.safeParse(input);
  if (!parseRes.success) {
    return {
      ok: false,
      error: 'invalid',
      message: parseRes.error.issues[0]?.message ?? 'Invalid template input.',
    };
  }
  const cleanInput = parseRes.data;
  const existing = readTemplates(publicKey);
  if (existing.length >= MAX_TEMPLATES_PER_WALLET) {
    return {
      ok: false,
      error: 'limit',
      message: `Maximum ${MAX_TEMPLATES_PER_WALLET} templates reached.`,
    };
  }
  const cleanTrimmedLabel = cleanInput.label.trim().toLowerCase();
  const duplicate = existing.some(
    (t) => t.direction === cleanInput.direction && t.label.trim().toLowerCase() === cleanTrimmedLabel
  );
  if (duplicate) {
    return {
      ok: false,
      error: 'duplicate_label',
      message: 'A template with this name already exists for this direction.',
    };
  }
  const isoNow = now.toISOString();
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const template: IntentTemplate = {
    ...cleanInput,
    schemaVersion: 1,
    id,
    createdAt: isoNow,
    updatedAt: isoNow,
  } as IntentTemplate;

  const ok = writeTemplates(publicKey, [...existing, template]);
  if (!ok) {
    return {
      ok: false,
      error: 'storage_unavailable',
      message: 'Storage unavailable or quota exceeded.',
    };
  }
  return { ok: true, template };
}

export function updateTemplate(
  publicKey: string,
  id: string,
  patch: TemplatePatch,
  now = new Date()
): SaveTemplateResult {
  if (!STELLAR_PUBKEY_PATTERN.test(publicKey)) {
    return { ok: false, error: 'invalid', message: 'Invalid Stellar public key.' };
  }
  const existing = readTemplates(publicKey);
  const index = existing.findIndex((t) => t.id === id);
  if (index === -1) {
    return { ok: false, error: 'not_found', message: 'Template not found.' };
  }
  const current = existing[index];
  const updatedCandidate = {
    ...current,
    ...patch,
    updatedAt: now.toISOString(),
  };

  const parseRes = IntentTemplateSchema.safeParse(updatedCandidate);
  if (!parseRes.success) {
    return {
      ok: false,
      error: 'invalid',
      message: parseRes.error.issues[0]?.message ?? 'Invalid template patch.',
    };
  }
  const validUpdated = parseRes.data;

  // Duplicate label check excluding itself
  const cleanTrimmedLabel = validUpdated.label.trim().toLowerCase();
  const duplicate = existing.some(
    (t) =>
      t.id !== id &&
      t.direction === validUpdated.direction &&
      t.label.trim().toLowerCase() === cleanTrimmedLabel
  );
  if (duplicate) {
    return {
      ok: false,
      error: 'duplicate_label',
      message: 'A template with this name already exists for this direction.',
    };
  }

  const updatedList = [...existing];
  updatedList[index] = validUpdated;
  const ok = writeTemplates(publicKey, updatedList);
  if (!ok) {
    return {
      ok: false,
      error: 'storage_unavailable',
      message: 'Storage unavailable or quota exceeded.',
    };
  }
  return { ok: true, template: validUpdated };
}

export function deleteTemplate(publicKey: string, id: string): boolean {
  if (!STELLAR_PUBKEY_PATTERN.test(publicKey)) return false;
  const existing = readTemplates(publicKey);
  const filtered = existing.filter((t) => t.id !== id);
  if (filtered.length === existing.length) return false;
  return writeTemplates(publicKey, filtered);
}

export function markTemplateUsed(publicKey: string, id: string, now = new Date()): void {
  if (!STELLAR_PUBKEY_PATTERN.test(publicKey)) return;
  const existing = readTemplates(publicKey);
  const index = existing.findIndex((t) => t.id === id);
  if (index === -1) return;
  const item = existing[index];
  if (!item) return;
  existing[index] = {
    ...item,
    lastUsedAt: now.toISOString(),
  };
  writeTemplates(publicKey, existing);
}

export function clearTemplates(publicKey: string): void {
  if (!STELLAR_PUBKEY_PATTERN.test(publicKey)) return;
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(templateStorageKey(publicKey));
  } catch {
    // silent
  }
}
