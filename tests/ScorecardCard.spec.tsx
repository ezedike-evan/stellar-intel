import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScorecardCard } from '@/components/offramp/ScorecardCard';

describe('ScorecardCard', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    // Default mock implementation to handle history calls gracefully
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            anchorId: 'example.anchor',
            window: '30d',
            buckets: [],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
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

  it('renders metrics from the windowed scorecards API response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        anchorId: 'example.anchor',
        scorecards: {
          90: {
            state: 'ok',
            window: 90,
            sampleSize: 42,
            fillRate: 0.952,
            settleMs: { p50: 18_500, p95: 90_000 },
            slippage: { p50: 0.003, p95: 0.0125 },
          },
        },
      }),
    });

    render(<ScorecardCard anchorId="example.anchor" window="90d" />);

    expect(await screen.findByText('Fill rate')).toBeInTheDocument();
    expect(screen.getByText('95.2%')).toBeInTheDocument();
    expect(screen.getByText('19s')).toBeInTheDocument();
    expect(screen.getByText('90s')).toBeInTheDocument();
    expect(screen.getByText('0.3%')).toBeInTheDocument();
    expect(screen.getByText('1.25%')).toBeInTheDocument();
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

  it('renders sparkline when history data is available', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            anchorId: 'example.anchor',
            window: '30d',
            buckets: [
              {
                timestamp: '2026-06-01T00:00:00Z',
                fillRate: 1,
                avgScore: 1,
                settlementLatencyMs: 15000,
                sampleCount: 1,
              },
              {
                timestamp: '2026-06-02T00:00:00Z',
                fillRate: 1,
                avgScore: 1,
                settlementLatencyMs: 25000,
                sampleCount: 1,
              },
            ],
          }),
        });
      }
      return Promise.resolve({
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
    });

    render(<ScorecardCard anchorId="example.anchor" window="30d" />);

    expect(await screen.findByText('Fill rate')).toBeInTheDocument();

    // Settle sparkline should be rendered
    const sparkline = await screen.findByTestId('scorecard-sparkline');
    expect(sparkline).toBeInTheDocument();

    // Verify SVG within sparkline exists
    const svg = screen.getByTestId('sparkline-svg');
    expect(svg).toBeInTheDocument();
  });
});
