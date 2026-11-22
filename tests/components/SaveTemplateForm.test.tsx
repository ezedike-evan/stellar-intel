import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SaveTemplateForm } from '@/components/templates/SaveTemplateForm';
import type { IntentTemplateDraft } from '@/lib/templates/schema';

describe('SaveTemplateForm (#2161 / TPL008)', () => {
  const draft: IntentTemplateDraft = {
    direction: 'offramp',
    corridorId: 'usdc-ngn',
    amount: '150.50',
    anchorId: 'cowrie',
  };

  it('renders pre-filled default label, summary line, and buttons', () => {
    const onSave = vi.fn();
    const onDismiss = vi.fn();

    render(<SaveTemplateForm draft={draft} onSave={onSave} onDismiss={onDismiss} />);

    expect(screen.getByRole('heading', { name: 'Save this as a template?' })).toBeDefined();
    expect(screen.getByText('150.50 USDC → NGN')).toBeDefined();

    const input = screen.getByLabelText('Template name') as HTMLInputElement;
    expect(input.value).toBe('USDC → NGN 150.50');
    expect(input.maxLength).toBe(60);

    expect(screen.getByRole('button', { name: 'Save template' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeDefined();
  });

  it('successful save replaces the form with status text', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockReturnValue({
      ok: true,
      template: {
        id: 'tpl-1',
        ...draft,
        label: 'My Custom Label',
        schemaVersion: 1,
        createdAt: '2026-11-20T12:00:00.000Z',
        updatedAt: '2026-11-20T12:00:00.000Z',
      },
    });
    const onDismiss = vi.fn();

    render(<SaveTemplateForm draft={draft} onSave={onSave} onDismiss={onDismiss} />);

    const input = screen.getByLabelText('Template name');
    await user.clear(input);
    await user.type(input, 'My Custom Label');

    await user.click(screen.getByRole('button', { name: 'Save template' }));

    expect(onSave).toHaveBeenCalledWith({
      ...draft,
      label: 'My Custom Label',
    });

    const statusMsg = screen.getByRole('status');
    expect(statusMsg.textContent).toBe('Saved as "My Custom Label".');
    expect(screen.queryByRole('button', { name: 'Save template' })).toBeNull();
  });

  it('each error code shows its error message with role="alert" and aria-invalid on input', async () => {
    const errorCases = [
      {
        result: { ok: false as const, error: 'invalid' as const, message: 'Invalid name provided' },
        expected: 'Invalid name provided',
      },
      {
        result: { ok: false as const, error: 'limit' as const, message: 'Too many' },
        expected: 'You have 50 templates. Delete one to save another.',
      },
      {
        result: { ok: false as const, error: 'duplicate_label' as const, message: 'Dup' },
        expected: 'A template with this name already exists.',
      },
      {
        result: { ok: false as const, error: 'storage_unavailable' as const, message: 'No storage' },
        expected: "This browser is blocking storage, so templates can't be saved here.",
      },
      {
        result: { ok: false as const, error: 'not_found' as const, message: 'Custom not found' },
        expected: 'Custom not found',
      },
    ];

    for (const { result, expected } of errorCases) {
      const user = userEvent.setup();
      const onSave = vi.fn().mockReturnValue(result);
      const onDismiss = vi.fn();

      const { unmount } = render(
        <SaveTemplateForm draft={draft} onSave={onSave} onDismiss={onDismiss} />
      );

      const input = screen.getByLabelText('Template name');
      await user.click(screen.getByRole('button', { name: 'Save template' }));

      const alert = screen.getByRole('alert');
      expect(alert.textContent).toBe(expected);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')).toBe('template-label-error');

      unmount();
    }
  });

  it('clicking "Not now" calls onDismiss', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onDismiss = vi.fn();

    render(<SaveTemplateForm draft={draft} onSave={onSave} onDismiss={onDismiss} />);

    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('enforces maxLength={60} so longer labels cannot be typed', () => {
    const onSave = vi.fn();
    const onDismiss = vi.fn();

    render(<SaveTemplateForm draft={draft} onSave={onSave} onDismiss={onDismiss} />);

    const input = screen.getByLabelText('Template name') as HTMLInputElement;
    expect(input.maxLength).toBe(60);
  });
});
