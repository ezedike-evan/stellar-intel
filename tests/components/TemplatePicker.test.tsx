import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplatePicker } from '@/components/templates/TemplatePicker';
import type { IntentTemplate } from '@/lib/templates/schema';

const MOCK_ONRAMP_TEMPLATE: IntentTemplate = {
  schemaVersion: 1,
  id: 'tpl-1',
  direction: 'onramp',
  label: 'NGN Savings',
  corridorId: 'usdc-ngn',
  amount: '100',
  anchorId: 'moneygram',
  assetId: 'stellar:native',
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
};

const MOCK_OFFRAMP_TEMPLATE: IntentTemplate = {
  schemaVersion: 1,
  id: 'tpl-2',
  direction: 'offramp',
  label: 'Mum in Lagos',
  corridorId: 'usdc-ngn',
  amount: '200',
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
};

describe('TemplatePicker', () => {
  const visibleCorridors = new Set(['usdc-ngn']);

  it('renders nothing when empty without onManage', () => {
    const { container } = render(
      <TemplatePicker
        templates={[]}
        visibleCorridorIds={visibleCorridors}
        onApply={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the Manage button when onManage is set even if empty', () => {
    const onManage = vi.fn();
    render(
      <TemplatePicker
        templates={[]}
        visibleCorridorIds={visibleCorridors}
        onApply={vi.fn()}
        onManage={onManage}
      />
    );
    expect(screen.getByRole('button', { name: 'Manage templates' })).toBeDefined();
  });

  it('formats option text with and without anchor name', () => {
    render(
      <TemplatePicker
        templates={[MOCK_ONRAMP_TEMPLATE, MOCK_OFFRAMP_TEMPLATE]}
        visibleCorridorIds={visibleCorridors}
        onApply={vi.fn()}
      />
    );
    // With anchor: MoneyGram
    expect(
      screen.getByText('NGN Savings — 100 USDC → NGN · MoneyGram')
    ).toBeDefined();
    // Without anchor
    expect(
      screen.getByText('Mum in Lagos — 200 USDC → NGN')
    ).toBeDefined();
  });

  it('disables option when corridor is not in visibleCorridorIds and adds suffix', () => {
    render(
      <TemplatePicker
        templates={[MOCK_ONRAMP_TEMPLATE]}
        visibleCorridorIds={new Set(['usdc-brl'])}
        onApply={vi.fn()}
      />
    );
    const option = screen.getByText(
      'NGN Savings — 100 USDC → NGN · MoneyGram (corridor unavailable)'
    ) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
  });

  it('calls onApply once and resets select value when template is chosen', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <TemplatePicker
        templates={[MOCK_ONRAMP_TEMPLATE]}
        visibleCorridorIds={visibleCorridors}
        onApply={onApply}
      />
    );
    const select = screen.getByLabelText('Saved templates') as HTMLSelectElement;
    expect(select.value).toBe('');

    await user.selectOptions(select, 'tpl-1');
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(MOCK_ONRAMP_TEMPLATE);
    expect(select.value).toBe('');
  });
});
