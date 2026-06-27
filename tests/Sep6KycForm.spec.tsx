import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sep6KycForm } from '@/components/offramp/Sep6KycForm';
import { buildSep6FormSchema } from '@/lib/stellar/sep6-form';

const schema = buildSep6FormSchema({
  full_name: { description: 'Full name' },
  bank_account: { description: 'Bank account number' },
  account_type: {
    description: 'Account type',
    choices: ['checking', 'savings'],
  },
  memo: { description: 'Memo', optional: true },
});

describe('Sep6KycForm', () => {
  it('renders a labeled input for each field', () => {
    render(<Sep6KycForm schema={schema} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/bank account number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/account type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/memo/i)).toBeInTheDocument();
  });

  it('renders a select for fields with choices', () => {
    render(<Sep6KycForm schema={schema} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: /account type/i });
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'checking' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'savings' })).toBeInTheDocument();
  });

  it('shows validation errors and blocks submit when required fields are empty', async () => {
    const onSubmit = vi.fn();
    render(<Sep6KycForm schema={schema} onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByText(/full name is required/i)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with field values when form is valid', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<Sep6KycForm schema={schema} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/full name/i), 'John Doe');
    await user.type(screen.getByLabelText(/bank account number/i), '123456789');
    await user.selectOptions(screen.getByRole('combobox', { name: /account type/i }), 'checking');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          full_name: 'John Doe',
          bank_account: '123456789',
          account_type: 'checking',
        })
      );
    });
  });

  it('clears field error when user corrects the input', async () => {
    const user = userEvent.setup();
    render(<Sep6KycForm schema={schema} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(screen.getByText(/full name is required/i)).toBeInTheDocument());

    await user.type(screen.getByLabelText(/full name/i), 'A');
    expect(screen.queryByText(/full name is required/i)).not.toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const onCancel = vi.fn();
    render(<Sep6KycForm schema={schema} onSubmit={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows submit error when onSubmit rejects', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('Anchor rejected KYC'));

    render(<Sep6KycForm schema={schema} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/full name/i), 'John Doe');
    await user.type(screen.getByLabelText(/bank account number/i), '123456789');
    await user.selectOptions(screen.getByRole('combobox', { name: /account type/i }), 'savings');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByText(/anchor rejected kyc/i)).toBeInTheDocument();
    });
  });
});
