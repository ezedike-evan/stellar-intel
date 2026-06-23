import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ScorecardCard } from '@/components/offramp/ScorecardCard';

describe('ScorecardCard', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading skeleton while fetching reputation data', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<ScorecardCard anchorId="example.anchor" window="7d" />);

    expect(screen.getByText('Anchor reputation')).toBeInTheDocument();
    expect(screen.getByText('Window: 7d')).toBeInTheDocument();
    expect(screen.queryByText('Fill rate')).not.toBeInTheDocument();
  });

  it('renders fill rate, settle and slippage metrics when data is available', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        fill_rate: 98.7,
        settle_p50: 21,
        settle_p95: 95,
        slippage_p50: 0.4,
        slippage_p95: 0.85,
        outcomes_count: 100,
      }),
    });

    render(<ScorecardCard anchorId="example.anchor" window="30d" />);

    expect(await screen.findByText('Fill rate')).toBeInTheDocument();
    expect(screen.getByText('98.7%')).toBeInTheDocument();
    expect(screen.getByText('21s')).toBeInTheDocument();
    expect(screen.getByText('95s')).toBeInTheDocument();
    expect(screen.getByText('0.4%')).toBeInTheDocument();
    expect(screen.getByText('0.85%')).toBeInTheDocument();
  });

  it('renders an empty state when the reputation API returns no metrics', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    render(<ScorecardCard anchorId="example.anchor" window="90d" />);

    expect(
      await screen.findByText('No reputation metrics available for this anchor.')
    ).toBeInTheDocument();
  });
});
