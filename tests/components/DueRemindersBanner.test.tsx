import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DueRemindersBanner } from '@/components/recurring/DueRemindersBanner';
import { RECURRING_IDS_STORAGE_KEY } from '@/lib/recurring/client';
import type { DueReminder } from '@/lib/recurring/due';

const ID_A = '0b6f1f8e-3a52-4c1d-9a0e-5f2b7c4d8e11';
const ID_B = '6c2d9a4b-1e7f-4b3a-8d5c-2a9e0f1b3c77';

function reminder(overrides: Partial<DueReminder>): DueReminder {
  return {
    authorizationId: ID_A,
    cycleNumber: 1,
    periodIndex: 0,
    periodStart: '2026-03-02T09:00:00.000Z',
    periodEnd: '2026-03-09T09:00:00.000Z',
    corridorId: 'usdc-ngn',
    sourceAsset: 'USDC',
    destinationAsset: 'NGN',
    amount: '100',
    remainingCap: '500',
    anchorAllowlist: ['moneygram'],
    termsHash: 'a'.repeat(64),
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  localStorage.clear();
});

describe('DueRemindersBanner (REC011)', () => {
  it('renders nothing and makes no fetch call when no ids are stored', async () => {
    const { container } = render(<DueRemindersBanner />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders one link per reminder with the exact pre-filled hrefs', async () => {
    localStorage.setItem(RECURRING_IDS_STORAGE_KEY, JSON.stringify([ID_A, ID_B]));
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          reminders: [
            reminder({}),
            reminder({
              authorizationId: ID_B,
              cycleNumber: 3,
              corridorId: 'usdc-kes',
              destinationAsset: 'KES',
              amount: '42.5',
            }),
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    render(<DueRemindersBanner />);

    const links = await screen.findAllByRole('link', { name: 'Pay now' });
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      `/offramp?corridor=usdc-ngn&amount=100&recurring=${ID_A}&cycle=1`,
      `/offramp?corridor=usdc-kes&amount=42.5&recurring=${ID_B}&cycle=3`,
    ]);
    expect(screen.getByText('100 USDC → NGN is due')).toBeInTheDocument();
    expect(screen.getByText('42.5 USDC → KES is due')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`/api/recurring/due?ids=${ID_A},${ID_B}`);
  });

  it('renders nothing when the fetch fails', async () => {
    localStorage.setItem(RECURRING_IDS_STORAGE_KEY, JSON.stringify([ID_A]));
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const { container } = render(<DueRemindersBanner />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on a non-2xx answer', async () => {
    localStorage.setItem(RECURRING_IDS_STORAGE_KEY, JSON.stringify([ID_A]));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Not found' }), { status: 404 })
    );

    const { container } = render(<DueRemindersBanner />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });
});
