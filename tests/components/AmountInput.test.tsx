import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AmountInput } from '@/components/ui/AmountInput';

describe('AmountInput', () => {
  it('calls onChange with the typed value', () => {
    const onChange = vi.fn();
    render(<AmountInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100' } });
    expect(onChange).toHaveBeenCalledWith('100');
  });

  it('does not call onChange for negative values', () => {
    const onChange = vi.fn();
    render(<AmountInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '-10' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders the USDC label', () => {
    render(<AmountInput value="100" onChange={vi.fn()} />);
    expect(screen.getByText('USDC')).toBeInTheDocument();
  });

  it('renders the helper text', () => {
    render(<AmountInput value="100" onChange={vi.fn()} />);
    expect(screen.getByText(/Enter the amount of USDC/)).toBeInTheDocument();
  });
});

describe('CorridorSelector', () => {
  it('renders all seven corridors as option elements', async () => {
    const { CorridorSelector } = await import('@/components/ui/CorridorSelector');
    render(<CorridorSelector value="usdc-ngn" onChange={vi.fn()} />);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(7);
  });

  it('fires onChange with "usdc-ghs" when Ghana is selected', async () => {
    const { CorridorSelector } = await import('@/components/ui/CorridorSelector');
    const onChange = vi.fn();
    render(<CorridorSelector value="usdc-ngn" onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'usdc-ghs' } });
    expect(onChange).toHaveBeenCalledWith('usdc-ghs');
  });
});
