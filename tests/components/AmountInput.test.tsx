import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AmountInput } from '@/components/ui/AmountInput';

describe('AmountInput', () => {
  it('calls onChange with the typed value', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<AmountInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '100' } });

    vi.advanceTimersByTime(250);
    expect(onChange).toHaveBeenCalledWith('100');
    vi.useRealTimers();
  });

  it('does not call onChange for negative values', () => {
    const onChange = vi.fn();
    render(<AmountInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '-10' } });
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

  it('renders the wallet balance when provided', () => {
    render(<AmountInput value="100" onChange={vi.fn()} balance={243.5} />);
    expect(screen.getByText('Balance: 243.5 USDC')).toBeInTheDocument();
  });

  it('does not render a balance line while it is loading', () => {
    render(<AmountInput value="100" onChange={vi.fn()} balance={243.5} isBalanceLoading />);
    expect(screen.queryByText(/Balance:/)).not.toBeInTheDocument();
  });

  it('shows "Insufficient balance" when the amount exceeds the wallet balance', () => {
    render(<AmountInput value="500" onChange={vi.fn()} balance={100} />);
    expect(screen.getByText('Insufficient balance')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not flag insufficient balance when the amount is within it', () => {
    render(<AmountInput value="50" onChange={vi.fn()} balance={100} />);
    expect(screen.queryByText('Insufficient balance')).not.toBeInTheDocument();
  });

  it('sets the amount to the floored balance when Max is clicked', () => {
    const onChange = vi.fn();
    render(<AmountInput value="10" onChange={onChange} balance={243.567} />);
    fireEvent.click(screen.getByRole('button', { name: 'Max' }));
    expect(onChange).toHaveBeenCalledWith('243.56');
  });

  it('does not render a Max button when there is no balance', () => {
    render(<AmountInput value="10" onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Max' })).not.toBeInTheDocument();
  });

  it('does not render a Max button when balance is zero', () => {
    render(<AmountInput value="10" onChange={vi.fn()} balance={0} />);
    expect(screen.queryByRole('button', { name: 'Max' })).not.toBeInTheDocument();
  });

  it('shows corridor-specific amount chips when defined', () => {
    render(<AmountInput value="10" onChange={vi.fn()} corridorId="usdc-mxn" />);
    expect(screen.getByRole('button', { name: '$100' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '$300' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '$500' })).toBeInTheDocument();
  });

  it('falls back to default chips for a corridor with no typical amounts defined', () => {
    render(<AmountInput value="10" onChange={vi.fn()} corridorId="not-a-real-corridor" />);
    expect(screen.getByRole('button', { name: '$50' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '$100' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '$500' })).toBeInTheDocument();
  });
});

describe('CorridorSelector', () => {
  it('renders all corridors as option elements', async () => {
    const { CorridorSelector } = await import('@/components/ui/CorridorSelector');
    render(<CorridorSelector value="usdc-ngn" onChange={vi.fn()} />);
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThanOrEqual(8);
  });

  it('fires onChange with "usdc-ghs" when Ghana is selected', async () => {
    const { CorridorSelector } = await import('@/components/ui/CorridorSelector');
    const onChange = vi.fn();
    render(<CorridorSelector value="usdc-ngn" onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'usdc-ghs' } });
    expect(onChange).toHaveBeenCalledWith('usdc-ghs');
  });
});
