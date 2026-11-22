import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveTemplate,
  listTemplates,
  updateTemplate,
  deleteTemplate,
  markTemplateUsed,
  clearTemplates,
} from '@/lib/templates/store';

const WALLET_A = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const WALLET_B = 'GAZW2PQFFJGH7RH6PB5VQASJIRAGEMZCID72CXYHRM27QYP4R5YRY777';

describe('intent-templates-store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and lists templates per wallet', () => {
    const resA = saveTemplate(WALLET_A, {
      direction: 'onramp',
      label: 'Savings A',
      corridorId: 'usdc-ngn',
      amount: '100',
    });
    expect(resA.ok).toBe(true);

    const listA = listTemplates(WALLET_A);
    expect(listA.length).toBe(1);
    expect(listA[0]?.label).toBe('Savings A');

    const listB = listTemplates(WALLET_B);
    expect(listB.length).toBe(0);
  });

  it('rejects invalid public keys', () => {
    const res = saveTemplate('invalid-key', {
      direction: 'onramp',
      label: 'Savings',
      corridorId: 'usdc-ngn',
      amount: '100',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('invalid');
    }
  });

  it('rejects duplicate labels for the same direction', () => {
    saveTemplate(WALLET_A, {
      direction: 'onramp',
      label: 'Savings',
      corridorId: 'usdc-ngn',
      amount: '100',
    });

    const dup = saveTemplate(WALLET_A, {
      direction: 'onramp',
      label: '  savings  ',
      corridorId: 'usdc-ngn',
      amount: '200',
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.error).toBe('duplicate_label');
    }

    // Allowed in the other direction
    const otherDir = saveTemplate(WALLET_A, {
      direction: 'offramp',
      label: 'Savings',
      corridorId: 'usdc-ngn',
      amount: '200',
    });
    expect(otherDir.ok).toBe(true);
  });

  it('updates, deletes, and marks template as used', () => {
    const res = saveTemplate(WALLET_A, {
      direction: 'onramp',
      label: 'Original',
      corridorId: 'usdc-ngn',
      amount: '100',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const id = res.template.id;

    // Update
    const updated = updateTemplate(WALLET_A, id, { label: 'Updated Name', amount: '150' });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.template.label).toBe('Updated Name');
    expect(updated.template.amount).toBe('150');

    // Mark used
    markTemplateUsed(WALLET_A, id, new Date('2026-11-21T10:00:00Z'));
    const list = listTemplates(WALLET_A);
    expect(list[0]?.lastUsedAt).toBe('2026-11-21T10:00:00.000Z');

    // Delete
    expect(deleteTemplate(WALLET_A, id)).toBe(true);
    expect(listTemplates(WALLET_A).length).toBe(0);
  });
});
