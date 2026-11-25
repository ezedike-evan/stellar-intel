import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateManager } from '@/components/templates/TemplateManager';
import type { UseIntentTemplatesResult } from '@/hooks/useIntentTemplates';
import type { IntentTemplate } from '@/lib/templates/schema';
import type { SaveTemplateResult } from '@/lib/templates/store';
import type { ImportMode, ImportSummary } from '@/lib/templates/transfer';

describe('TemplateManager', () => {
  let mockTemplates: IntentTemplate[];
  let mockApi: UseIntentTemplatesResult;
  let onClose: () => void;

  beforeEach(() => {
    mockTemplates = [
      {
        schemaVersion: 1,
        id: 'tpl-1',
        direction: 'offramp',
        label: 'Mum in Lagos',
        corridorId: 'usdc-ngn',
        amount: '200',
        createdAt: '2026-11-20T10:00:00.000Z',
        updatedAt: '2026-11-20T10:00:00.000Z',
      },
    ];

    mockApi = {
      get templates() {
        return mockTemplates;
      },
      storageAvailable: true,
      save: vi.fn(),
      rename: vi.fn((id: string, label: string): SaveTemplateResult => {
        if (label === 'Existing') {
          return {
            ok: false,
            error: 'duplicate_label',
            message: 'A template with this name already exists for this direction.',
          };
        }
        const t = mockTemplates.find((x) => x.id === id);
        if (t) t.label = label;
        return { ok: true, template: t! };
      }),
      updateAmount: vi.fn((id: string, amount: string): SaveTemplateResult => {
        if (amount === '0' || parseFloat(amount) <= 0) {
          return { ok: false, error: 'invalid', message: 'amount must be greater than zero' };
        }
        const t = mockTemplates.find((x) => x.id === id);
        if (t) t.amount = amount;
        return { ok: true, template: t! };
      }),
      remove: vi.fn((id) => {
        mockTemplates = mockTemplates.filter((x) => x.id !== id);
        return true;
      }),
      markUsed: vi.fn(),
      exportJson: vi.fn(() =>
        JSON.stringify({
          format: 'stellar-intel/intent-templates',
          version: 1,
          exportedAt: '2026-11-20T10:00:00Z',
          templates: mockTemplates,
        })
      ),
      importJson: vi.fn(
        (
          text: string,
          _mode: ImportMode
        ): { ok: true; summary: ImportSummary } | { ok: false; error: string } => {
          try {
            JSON.parse(text);
            return { ok: true, summary: { added: 1, updated: 0, skipped: 0 } };
          } catch {
            return { ok: false, error: 'This file is not valid JSON.' };
          }
        }
      ),
    };

    onClose = vi.fn();
  });

  it('renders nothing when closed; renders dialog and focuses heading when open', () => {
    const { rerender } = render(<TemplateManager open={false} onClose={onClose} api={mockApi} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(<TemplateManager open={true} onClose={onClose} api={mockApi} />);
    const dialog = screen.getByRole('dialog', { name: 'Manage templates' });
    expect(dialog).toBeDefined();

    const heading = screen.getByRole('heading', { name: 'Manage templates' });
    expect(document.activeElement).toBe(heading);
  });

  it('calls onClose when Escape is pressed', async () => {
    const user = userEvent.setup();
    render(<TemplateManager open={true} onClose={onClose} api={mockApi} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renames a template and shows alert on duplicate label', async () => {
    const user = userEvent.setup();
    render(<TemplateManager open={true} onClose={onClose} api={mockApi} />);

    // Click Rename
    await user.click(screen.getByRole('button', { name: 'Rename Mum in Lagos' }));

    const input = screen.getByLabelText('New name');
    await user.clear(input);
    await user.type(input, 'Mum in Abuja');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockApi.rename).toHaveBeenCalledWith('tpl-1', 'Mum in Abuja');

    // Rename again with duplicate
    await user.click(screen.getByRole('button', { name: 'Rename Mum in Abuja' }));
    const input2 = screen.getByLabelText('New name');
    await user.clear(input2);
    await user.type(input2, 'Existing');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A template with this name already exists for this direction.'
    );
  });

  it('shows alert when editing amount to 0', async () => {
    const user = userEvent.setup();
    render(<TemplateManager open={true} onClose={onClose} api={mockApi} />);

    await user.click(screen.getByRole('button', { name: 'Edit amount for Mum in Lagos' }));

    const input = screen.getByLabelText('Amount');
    await user.clear(input);
    await user.type(input, '0');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('amount must be greater than zero');
  });

  it('requires inline confirm before deleting', async () => {
    const user = userEvent.setup();
    render(<TemplateManager open={true} onClose={onClose} api={mockApi} />);

    await user.click(screen.getByRole('button', { name: 'Delete Mum in Lagos' }));

    expect(screen.getByText('Delete "Mum in Lagos"?')).toBeDefined();

    // Confirm Delete
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mockApi.remove).toHaveBeenCalledWith('tpl-1');
  });

  it('exports templates via URL.createObjectURL and URL.revokeObjectURL', async () => {
    const user = userEvent.setup();
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    render(<TemplateManager open={true} onClose={onClose} api={mockApi} />);

    await user.click(screen.getByRole('button', { name: 'Export templates' }));

    expect(mockApi.exportJson).toHaveBeenCalled();
    expect(createUrlSpy).toHaveBeenCalled();
    expect(revokeUrlSpy).toHaveBeenCalledWith('blob:test');

    createUrlSpy.mockRestore();
    revokeUrlSpy.mockRestore();
  });

  it('imports valid JSON file, rejects invalid JSON, and checks size limit', async () => {
    const user = userEvent.setup();
    render(<TemplateManager open={true} onClose={onClose} api={mockApi} />);

    const input = screen.getByLabelText('Import templates (JSON)') as HTMLInputElement;

    // 1. Valid file
    const validFile = new File(['{"valid":true}'], 'templates.json', { type: 'application/json' });
    await user.upload(input, validFile);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Imported: 1 added, 0 updated, 0 skipped.'
    );

    // 2. Non-JSON file
    const invalidFile = new File(['not json'], 'invalid.json', { type: 'application/json' });
    await user.upload(input, invalidFile);
    expect(await screen.findByRole('alert')).toHaveTextContent('This file is not valid JSON.');

    // 3. Oversized file (> 100_000 bytes)
    const largeFile = new File(['a'.repeat(100_001)], 'large.json', { type: 'application/json' });
    await user.upload(input, largeFile);
    expect(await screen.findByRole('alert')).toHaveTextContent('File is too large.');
  });
});
