import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TemplatePicker } from '@/components/templates/TemplatePicker';
import type { IntentTemplate } from '@/lib/templates/schema';

function template(overrides: Partial<IntentTemplate> = {}): IntentTemplate {
  return {
    schemaVersion: 1,
    id: 'tpl-1',
    direction: 'offramp',
    label: 'Rent',
    corridorId: 'usdc-ngn',
    amount: '120',
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
    ...overrides,
  } as IntentTemplate;
}

const VISIBLE = new Set(['usdc-ngn']);

describe('TemplatePicker (#2159)', () => {
  it('renders nothing with no templates and no manage action', () => {
    const { container } = render(
      <TemplatePicker templates={[]} visibleCorridorIds={VISIBLE} onApply={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the manage button when onManage is set, even with no templates', () => {
    render(
      <TemplatePicker
        templates={[]}
        visibleCorridorIds={VISIBLE}
        onApply={vi.fn()}
        onManage={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Manage templates' })).toBeInTheDocument();
  });

  it('formats each option, with the anchor name when it is known', () => {
    render(
      <TemplatePicker
        templates={[template(), template({ id: 'tpl-2', label: 'Fees', anchorId: 'moneygram' })]}
        visibleCorridorIds={VISIBLE}
        onApply={vi.fn()}
      />
    );
    expect(screen.getByRole('option', { name: 'Rent — 120 USDC → NGN' })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Fees — 120 USDC → NGN · MoneyGram' })
    ).toBeInTheDocument();
  });

  it('disables a template whose corridor is not available', () => {
    render(
      <TemplatePicker
        templates={[template({ corridorId: 'usdc-zar' })]}
        visibleCorridorIds={VISIBLE}
        onApply={vi.fn()}
      />
    );
    expect(
      screen.getByRole('option', { name: 'Rent — 120 USDC → ZAR (corridor unavailable)' })
    ).toBeDisabled();
  });

  it('applies the chosen template once and resets the select', () => {
    const onApply = vi.fn();
    render(
      <TemplatePicker templates={[template()]} visibleCorridorIds={VISIBLE} onApply={onApply} />
    );
    const select = screen.getByLabelText('Saved templates') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'tpl-1' } });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ id: 'tpl-1' }));
    expect(select.value).toBe('');
  });
});
