import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTemplates,
  deleteTemplate,
  listTemplates,
  markTemplateUsed,
  readTemplates,
  saveTemplate,
  templateStorageKey,
  updateTemplate,
} from '@/lib/templates/store';
import type { IntentTemplateInput } from '@/lib/templates/schema';

const WALLET_A = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const WALLET_B = 'GAZW2PQFFJGH7RH6PB5VQASJIRAGEMZCID72CXYHRM27QYP4R5YRY777';

function offramp(label: string, amount = '100'): IntentTemplateInput {
  return { direction: 'offramp', label, corridorId: 'usdc-ngn', amount };
}

function onramp(label: string): IntentTemplateInput {
  return { direction: 'onramp', label, corridorId: 'usdc-ngn', amount: '500' };
}

function stored(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: 'tpl-1',
    direction: 'offramp',
    label: 'Rent',
    corridorId: 'usdc-ngn',
    amount: '100',
    createdAt: '2026-11-20T12:00:00.000Z',
    updatedAt: '2026-11-20T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('intent template store (#2155)', () => {
  it('round-trips a saved template, per wallet', () => {
    const saved = saveTemplate(WALLET_A, offramp('Rent'));
    expect(saved.ok).toBe(true);
    const list = listTemplates(WALLET_A);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ label: 'Rent', schemaVersion: 1, direction: 'offramp' });
    expect(listTemplates(WALLET_B)).toEqual([]);
  });

  it('rejects an invalid public key', () => {
    expect(saveTemplate('not-a-key', offramp('Rent'))).toMatchObject({
      ok: false,
      error: 'invalid',
    });
    expect(listTemplates('not-a-key')).toEqual([]);
  });

  it('reads corrupted JSON as no templates', () => {
    localStorage.setItem(templateStorageKey(WALLET_A), '{not json');
    expect(readTemplates(WALLET_A)).toEqual([]);
  });

  it('keeps only the valid entries of a stored array', () => {
    localStorage.setItem(
      templateStorageKey(WALLET_A),
      JSON.stringify([stored(), stored({ id: 'tpl-2', amount: '-5' })])
    );
    expect(readTemplates(WALLET_A)).toHaveLength(1);
  });

  it('drops an entry carrying an unknown key such as recipientName', () => {
    localStorage.setItem(
      templateStorageKey(WALLET_A),
      JSON.stringify([stored({ recipientName: 'Ada' })])
    );
    expect(readTemplates(WALLET_A)).toEqual([]);
  });

  it('refuses the 51st template', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(saveTemplate(WALLET_A, offramp(`Template ${i}`)).ok).toBe(true);
    }
    expect(saveTemplate(WALLET_A, offramp('One too many'))).toMatchObject({
      ok: false,
      error: 'limit',
    });
  });

  it('refuses a duplicate label in the same direction, case-insensitively', () => {
    saveTemplate(WALLET_A, offramp('Rent'));
    expect(saveTemplate(WALLET_A, offramp('  rent '))).toMatchObject({
      ok: false,
      error: 'duplicate_label',
    });
    expect(saveTemplate(WALLET_A, onramp('Rent')).ok).toBe(true);
  });

  it('reports storage_unavailable when setItem throws, without throwing', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    try {
      expect(saveTemplate(WALLET_A, offramp('Rent'))).toMatchObject({
        ok: false,
        error: 'storage_unavailable',
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('reads nothing when getItem throws', () => {
    saveTemplate(WALLET_A, offramp('Rent'));
    const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('disabled');
    });
    try {
      expect(listTemplates(WALLET_A)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('lists the most recently used template first', () => {
    const a = saveTemplate(WALLET_A, offramp('A'), new Date('2026-11-20T10:00:00Z'));
    saveTemplate(WALLET_A, offramp('B'), new Date('2026-11-20T11:00:00Z'));
    expect(listTemplates(WALLET_A).map((t) => t.label)).toEqual(['B', 'A']);

    if (!a.ok) throw new Error('save failed');
    markTemplateUsed(WALLET_A, a.template.id, new Date('2026-11-20T12:00:00Z'));
    expect(listTemplates(WALLET_A).map((t) => t.label)).toEqual(['A', 'B']);
  });

  it('filters by direction', () => {
    saveTemplate(WALLET_A, offramp('Out'));
    saveTemplate(WALLET_A, onramp('In'));
    expect(listTemplates(WALLET_A, 'onramp').map((t) => t.label)).toEqual(['In']);
  });

  it('renames a template', () => {
    const saved = saveTemplate(WALLET_A, offramp('Rent'));
    if (!saved.ok) throw new Error('save failed');
    expect(updateTemplate(WALLET_A, saved.template.id, { label: 'Rent (Lagos)' })).toMatchObject({
      ok: true,
      template: { label: 'Rent (Lagos)' },
    });
  });

  it('rejects an invalid amount patch and leaves the stored value alone', () => {
    const saved = saveTemplate(WALLET_A, offramp('Rent', '100'));
    if (!saved.ok) throw new Error('save failed');
    expect(updateTemplate(WALLET_A, saved.template.id, { amount: '-1' })).toMatchObject({
      ok: false,
      error: 'invalid',
    });
    expect(readTemplates(WALLET_A)[0]?.amount).toBe('100');
  });

  it('answers not_found for an unknown id', () => {
    expect(updateTemplate(WALLET_A, 'missing', { label: 'X' })).toMatchObject({
      ok: false,
      error: 'not_found',
    });
  });

  it('deletes once, then reports nothing to delete', () => {
    const saved = saveTemplate(WALLET_A, offramp('Rent'));
    if (!saved.ok) throw new Error('save failed');
    expect(deleteTemplate(WALLET_A, saved.template.id)).toBe(true);
    expect(deleteTemplate(WALLET_A, saved.template.id)).toBe(false);
  });

  it('clears every template of a wallet', () => {
    saveTemplate(WALLET_A, offramp('Rent'));
    clearTemplates(WALLET_A);
    expect(listTemplates(WALLET_A)).toEqual([]);
  });
});
