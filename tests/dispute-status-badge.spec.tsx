import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DisputeStatusBadge } from '@/components/offramp/DisputeStatusBadge';
import { DISPUTE_LEVEL_LABELS } from '@/lib/reputation/dispute-ladder';

describe('DisputeStatusBadge (#2136)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when there are no disputes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ disputes: [] }),
    } as Response);

    const { container } = render(<DisputeStatusBadge intentHash={'a'.repeat(64)} />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('renders open dispute with level label and decision due date', async () => {
    const deadline = '2026-11-24T12:00:00.000Z';
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        disputes: [
          {
            ref: 'a1b2c3d4e5f67890',
            category: 'delayed',
            level: 'anchor',
            levelDeadline: deadline,
            status: 'open',
            createdAt: '2026-11-21T12:00:00.000Z',
            resolvedAt: null,
          },
        ],
      }),
    } as Response);

    render(<DisputeStatusBadge intentHash={'b'.repeat(64)} />);

    await waitFor(() => {
      const badge = screen.getByTestId('dispute-status-badge');
      expect(badge).toBeDefined();
      expect(badge.textContent).toContain('Dispute open');
      expect(badge.textContent).toContain(DISPUTE_LEVEL_LABELS['anchor']);
      expect(badge.textContent).toContain('decision due');
      expect(badge.textContent).toContain('Nov 24');
    });
  });

  it('renders accepted dispute with reference and /disputes link', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        disputes: [
          {
            ref: 'deadbeef12345678',
            category: 'wrong_amount',
            level: 'review',
            levelDeadline: '2026-11-20T12:00:00.000Z',
            status: 'accepted',
            createdAt: '2026-11-17T12:00:00.000Z',
            resolvedAt: '2026-11-19T12:00:00.000Z',
          },
        ],
      }),
    } as Response);

    render(<DisputeStatusBadge intentHash={'c'.repeat(64)} />);

    await waitFor(() => {
      const badge = screen.getByTestId('dispute-status-badge');
      expect(badge).toBeDefined();
      expect(badge.textContent).toContain('Dispute accepted · reference');
      expect(badge.textContent).toContain('deadbeef12345678');
      const link = screen.getByRole('link', { name: 'deadbeef12345678' });
      expect(link.getAttribute('href')).toBe('/disputes');
    });
  });

  it('renders rejected dispute with reference and /disputes link', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        disputes: [
          {
            ref: 'feedface87654321',
            category: 'other',
            level: 'review',
            levelDeadline: '2026-11-20T12:00:00.000Z',
            status: 'rejected',
            createdAt: '2026-11-17T12:00:00.000Z',
            resolvedAt: '2026-11-19T12:00:00.000Z',
          },
        ],
      }),
    } as Response);

    render(<DisputeStatusBadge intentHash={'d'.repeat(64)} />);

    await waitFor(() => {
      const badge = screen.getByTestId('dispute-status-badge');
      expect(badge).toBeDefined();
      expect(badge.textContent).toContain('Dispute rejected · reference');
      expect(badge.textContent).toContain('feedface87654321');
      const link = screen.getByRole('link', { name: 'feedface87654321' });
      expect(link.getAttribute('href')).toBe('/disputes');
    });
  });
});
