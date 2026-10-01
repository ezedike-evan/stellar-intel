import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VISIBLE_CORRIDORS } from '@/constants/anchors';

describe('CorridorSelector', () => {
  it('only renders visible corridors as options', async () => {
    const { CorridorSelector } = await import('@/components/ui/CorridorSelector');
    const visibleIds = new Set(VISIBLE_CORRIDORS.map((corridor) => corridor.id));

    render(<CorridorSelector value="usdc-ngn" onChange={vi.fn()} />);

    for (const option of screen.getAllByRole('option')) {
      expect(visibleIds.has(option.getAttribute('value') ?? '')).toBe(true);
    }
  });

  it('labels options with the source and payout assets', async () => {
    const { CorridorSelector } = await import('@/components/ui/CorridorSelector');

    render(<CorridorSelector value="usdc-ngn" onChange={vi.fn()} />);

    // Disambiguates corridors that share a payout currency but sell
    // different on-chain assets (e.g. usdc-ars vs ars-ars).
    const ngn = screen.getByRole('option', { name: /Nigeria \(USDC → NGN\)/ });
    expect(ngn.getAttribute('value')).toBe('usdc-ngn');
  });

  it('filters options to the given assetCode', async () => {
    const { CorridorSelector } = await import('@/components/ui/CorridorSelector');
    const byId = new Map(VISIBLE_CORRIDORS.map((corridor) => [corridor.id, corridor]));

    const { unmount } = render(
      <CorridorSelector value="ars-ars" onChange={vi.fn()} assetCode="ARS" />
    );
    const arsOptions = screen.getAllByRole('option');
    expect(arsOptions.length).toBeGreaterThan(0);
    for (const option of arsOptions) {
      expect(byId.get(option.getAttribute('value') ?? '')?.from).toBe('ARS');
    }
    unmount();

    render(<CorridorSelector value="usdc-ngn" onChange={vi.fn()} assetCode="USDC" />);
    const usdcOptions = screen.getAllByRole('option');
    expect(usdcOptions.length).toBeGreaterThan(0);
    for (const option of usdcOptions) {
      expect(byId.get(option.getAttribute('value') ?? '')?.from).toBe('USDC');
    }
  });

  it('forwards the picked corridor id', async () => {
    const { CorridorSelector } = await import('@/components/ui/CorridorSelector');
    const onChange = vi.fn();

    render(<CorridorSelector value="usdc-ngn" onChange={onChange} assetCode="USDC" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'usdc-kes' } });
    expect(onChange).toHaveBeenCalledWith('usdc-kes');
  });
});
