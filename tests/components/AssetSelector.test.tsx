import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VISIBLE_CORRIDORS } from '@/constants/anchors';

describe('AssetSelector', () => {
  it('lists each distinct source asset once, in first-seen order', async () => {
    const { AssetSelector } = await import('@/components/ui/AssetSelector');
    const expected = [...new Set(VISIBLE_CORRIDORS.map((corridor) => corridor.from))];

    render(<AssetSelector value={expected[0]!} onChange={vi.fn()} corridors={VISIBLE_CORRIDORS} />);

    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.getAttribute('value'))).toEqual(expected);
  });

  it('forwards the picked asset code', async () => {
    const { AssetSelector } = await import('@/components/ui/AssetSelector');
    const onChange = vi.fn();

    render(<AssetSelector value="USDC" onChange={onChange} corridors={VISIBLE_CORRIDORS} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ARS' } });
    expect(onChange).toHaveBeenCalledWith('ARS');
  });
});
