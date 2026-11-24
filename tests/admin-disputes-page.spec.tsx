import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AdminDisputesPage from '@/app/admin/disputes/page';
import type { Dispute } from '@/lib/reputation/disputes';

describe('AdminDisputesPage (#2132)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const baseDispute: Dispute = {
    id: 'disp-1',
    intentHash: 'a'.repeat(64),
    publicKey: 'GAAABBBCCCDDDEEEFFFGGGHHHIIIJJJKKKLLLMMMNNNOOOPPPQQQRRRSSSTTT11',
    anchorId: 'cowrie',
    reason: 'Delayed offramp payout',
    status: 'open',
    category: 'delayed',
    level: 'anchor',
    levelDeadline: new Date(Date.now() + 86400000).toISOString(),
    subjectKind: 'outcome',
    subjectRef: 'a'.repeat(64),
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    appealedAt: null,
  };

  async function loginAdmin() {
    const input = screen.getByPlaceholderText('Admin key');
    fireEvent.change(input, { target: { value: 'secret-admin-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }

  it('renders level, category, and due date', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [baseDispute],
    } as Response);

    render(<AdminDisputesPage />);
    await loginAdmin();

    await waitFor(() => {
      expect(screen.getByText('Dispute queue')).toBeDefined();
    });

    expect(screen.getByText('Unreasonable delay')).toBeDefined();
    expect(screen.getByText('Anchor response')).toBeDefined();
    expect(screen.getByText(/Due /)).toBeDefined();
    expect(screen.queryByText('Overdue')).toBeNull();
  });

  it('shows Overdue badge when dispute deadline is in the past', async () => {
    const overdueDispute: Dispute = {
      ...baseDispute,
      id: 'disp-overdue',
      levelDeadline: new Date(Date.now() - 3600000).toISOString(),
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [overdueDispute],
    } as Response);

    render(<AdminDisputesPage />);
    await loginAdmin();

    await waitFor(() => {
      expect(screen.getByText('Overdue')).toBeDefined();
    });
  });

  it('disables Accept until rationale is typed, and clicking Accept sends rationale', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [baseDispute],
    } as Response);

    render(<AdminDisputesPage />);
    await loginAdmin();

    await waitFor(() => {
      expect(screen.getByText('cowrie')).toBeDefined();
    });

    const acceptBtn = screen.getByRole('button', { name: 'Accept' });
    expect(acceptBtn.hasAttribute('disabled')).toBe(true);

    const textarea = screen.getByPlaceholderText('Explain the public basis for this decision');
    fireEvent.change(textarea, { target: { value: 'Anchor confirmed ledger transaction' } });

    expect(acceptBtn.hasAttribute('disabled')).toBe(false);

    const postSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ...baseDispute,
        status: 'accepted',
        resolvedAt: new Date().toISOString(),
      }),
    } as Response);

    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        '/api/admin/disputes',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            id: 'disp-1',
            action: 'accept',
            rationale: 'Anchor confirmed ledger transaction',
          }),
        })
      );
    });
  });

  it('shows Escalate button at anchor level, but hides it at review level', async () => {
    const reviewDispute: Dispute = {
      ...baseDispute,
      id: 'disp-review',
      level: 'review',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [baseDispute, reviewDispute],
    } as Response);

    render(<AdminDisputesPage />);
    await loginAdmin();

    await waitFor(() => {
      expect(screen.getAllByText(/Public rationale/).length).toBe(2);
    });

    // Only one dispute is at 'anchor' level, so there should be exactly one Escalate button
    const escalateButtons = screen.getAllByRole('button', { name: /Escalate to/ });
    expect(escalateButtons.length).toBe(1);
    expect(escalateButtons[0]!.textContent).toContain('Maintainer review');
  });

  it('displays error message when server responds 400 (e.g. rationale contains account address)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [baseDispute],
    } as Response);

    render(<AdminDisputesPage />);
    await loginAdmin();

    await waitFor(() => {
      expect(screen.getByText('cowrie')).toBeDefined();
    });

    const textarea = screen.getByPlaceholderText('Explain the public basis for this decision');
    fireEvent.change(textarea, { target: { value: 'Account G123456789' } });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        code: 'RATIONALE_NOT_PUBLIC_SAFE',
        message: 'rationale contains an account address',
      }),
    } as Response);

    const acceptBtn = screen.getByRole('button', { name: 'Accept' });
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(screen.getByText('rationale contains an account address')).toBeDefined();
    });
  });
});
