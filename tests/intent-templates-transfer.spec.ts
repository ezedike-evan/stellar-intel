import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_IMPORT_BYTES,
  buildTemplateExport,
  importTemplates,
  parseTemplateImport,
  serializeTemplateExport,
  templateExportFilename,
} from '@/lib/templates/transfer';
import { readTemplates, writeTemplates } from '@/lib/templates/store';
import type { IntentTemplate } from '@/lib/templates/schema';

const WALLET = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

function template(overrides: Partial<IntentTemplate> = {}): IntentTemplate {
  return {
    schemaVersion: 1,
    id: 'tpl-1',
    direction: 'offramp',
    label: 'Rent',
    corridorId: 'usdc-ngn',
    amount: '100',
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
    ...overrides,
  } as IntentTemplate;
}

function exportText(templates: unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: 'stellar-intel/intent-templates',
    version: 1,
    exportedAt: '2026-11-20T10:00:00.000Z',
    templates,
    ...overrides,
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe('intent template export and import (#2156)', () => {
  it('round-trips export, serialize and parse', () => {
    const templates = [template(), template({ id: 'tpl-2', label: 'School fees' })];
    const text = serializeTemplateExport(buildTemplateExport(templates));
    expect(parseTemplateImport(text)).toEqual({ ok: true, templates });
  });

  it.each([
    ['a wrong format', exportText([template()], { format: 'something-else' })],
    ['version 2', exportText([template()], { version: 2 })],
    ['an extra key on a template', exportText([{ ...template(), recipientName: 'Ada' }])],
  ])('rejects %s as not a templates file', (_label, text) => {
    expect(parseTemplateImport(text)).toEqual({
      ok: false,
      error: 'This is not a Stellar Intel templates file.',
    });
  });

  it('rejects non-JSON', () => {
    expect(parseTemplateImport('{nope')).toEqual({
      ok: false,
      error: 'This file is not valid JSON.',
    });
  });

  it('rejects a file over the size limit without parsing it', () => {
    expect(parseTemplateImport('x'.repeat(MAX_IMPORT_BYTES + 1))).toEqual({
      ok: false,
      error: 'File is too large.',
    });
  });

  describe('merge', () => {
    it('adds new templates', () => {
      const result = importTemplates(WALLET, [template()], 'merge');
      expect(result).toEqual({ ok: true, summary: { added: 1, updated: 0, skipped: 0 } });
      expect(readTemplates(WALLET)).toHaveLength(1);
    });

    it('updates the same id when the incoming copy is newer, and skips it when older', () => {
      writeTemplates(WALLET, [template()]);
      const newer = template({ label: 'Rent (new)', updatedAt: '2026-11-21T10:00:00.000Z' });
      expect(importTemplates(WALLET, [newer], 'merge')).toMatchObject({
        summary: { added: 0, updated: 1, skipped: 0 },
      });
      const older = template({ label: 'Rent (old)', updatedAt: '2026-11-19T10:00:00.000Z' });
      expect(importTemplates(WALLET, [older], 'merge')).toMatchObject({
        summary: { added: 0, updated: 0, skipped: 1 },
      });
      expect(readTemplates(WALLET)[0]?.label).toBe('Rent (new)');
    });

    it('skips a new id whose label clashes in the same direction', () => {
      writeTemplates(WALLET, [template()]);
      expect(
        importTemplates(WALLET, [template({ id: 'tpl-9', label: 'RENT' })], 'merge')
      ).toMatchObject({ summary: { added: 0, updated: 0, skipped: 1 } });
    });

    it('skips additions past the 50-template cap', () => {
      writeTemplates(
        WALLET,
        Array.from({ length: 50 }, (_, i) => template({ id: `t-${i}`, label: `T ${i}` }))
      );
      expect(
        importTemplates(WALLET, [template({ id: 'extra', label: 'Extra' })], 'merge')
      ).toMatchObject({ summary: { added: 0, updated: 0, skipped: 1 } });
    });
  });

  it('replace overwrites the stored list', () => {
    writeTemplates(WALLET, [template()]);
    const incoming = [template({ id: 'tpl-2', label: 'Other' })];
    expect(importTemplates(WALLET, incoming, 'replace')).toEqual({
      ok: true,
      summary: { added: 1, updated: 0, skipped: 0 },
    });
    expect(readTemplates(WALLET).map((t) => t.id)).toEqual(['tpl-2']);
  });

  it('rejects an invalid public key', () => {
    expect(importTemplates('nope', [template()], 'merge')).toEqual({ ok: false, error: 'invalid' });
  });

  it('names the export file by date', () => {
    expect(templateExportFilename(new Date('2026-11-20T10:00:00Z'))).toBe(
      'stellar-intel-templates-2026-11-20.json'
    );
  });
});
