import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { DueRemindersBanner } from '@/components/recurring/DueRemindersBanner';

describe('DueRemindersBanner', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('renders nothing when localStorage has no standing order IDs', () => {
    const { container } = render(<DueRemindersBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('fetches due reminders and displays banner when payments are due', async () => {
    window.localStorage.setItem('si_standing_order_ids', JSON.stringify(['auth-1']));

    const mockReminders = [
      {
        authorizationId: 'auth-1',
        sender: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        corridorId: 'usdc-ngn',
        sourceAsset: 'USDC',
        destinationAsset: 'NGN',
        amount: '50',
        remainingCap: '200',
        period: 'daily',
        phase: 'due',
        due: true,
        nextDueAt: '2026-06-02T00:00:00.000Z',
        missedPeriods: 0,
      },
    ];

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reminders: mockReminders }),
    } as Response);

    render(<DueRemindersBanner />);

    await waitFor(() => {
      expect(screen.getByRole('region')).toBeInTheDocument();
      expect(screen.getByText(/You have 1 standing payment due/i)).toBeInTheDocument();
      expect(screen.getByText(/50 USDC → NGN/i)).toBeInTheDocument();
    });
  });
});
