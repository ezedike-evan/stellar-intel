import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DisputeModal } from '@/components/offramp/DisputeModal';
import type { WithdrawStatusValue } from '@/types';

describe('DisputeModal', () => {
  const defaultProps = {
    transactionId: 'tx-abc-123',
    status: 'completed' as const,
    onClose: vi.fn(),
    onSubmit: vi.fn().mockResolvedValue(undefined),
  };

  it('renders modal for completed status', () => {
    render(<DisputeModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('Flag Incorrect Outcome')).toBeDefined();
  });

  it('does not render for non-disputable status', () => {
    const { container } = render(
      <DisputeModal {...defaultProps} status={'pending_anchor' as WithdrawStatusValue} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('submit button is disabled without reason', () => {
    render(<DisputeModal {...defaultProps} />);
    const btn = screen.getByRole('button', { name: /submit dispute/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls onSubmit with correct data', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<DisputeModal {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'wrong_amount' },
    });
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'I received 500 instead of 1000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit dispute/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        transactionId: 'tx-abc-123',
        reason: 'wrong_amount',
        notes: 'I received 500 instead of 1000',
      });
    });
  });

  it('shows acknowledgement after successful submission', async () => {
    render(<DisputeModal {...defaultProps} />);
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'not_received' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit dispute/i }));
    await waitFor(() => {
      expect(screen.getByText('Dispute submitted')).toBeDefined();
    });
  });

  it('shows error message on submission failure', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Server error'));
    render(<DisputeModal {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'delayed' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit dispute/i }));
    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeDefined();
    });
  });
});
