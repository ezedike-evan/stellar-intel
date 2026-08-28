import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/constants', () => ({
  ANCHORS: [
    {
      id: 'meta.anchor',
      name: 'Meta Anchor',
      homeDomain: 'meta.anchor',
      corridors: ['usdc-ngn'],
      assetCode: 'USDC',
      assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      metadata: {
        regions: { senders: 'All countries', receivers: 'Nigerian residents' },
        kycModel: 'Anchor-hosted (standard SEP-24 interactive popup)',
        feeModel: 'Flat $0.50 USDC + 0.5% spread',
      },
    },
  ],
}));

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

    // The heading splits the anchor name into its own <span>, so match on the
    // paragraph's full text rather than a single text node.
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === 'P' &&
          element.textContent?.replace(/\s+/g, ' ').trim() === 'example.anchor reputation'
      )
    ).toBeInTheDocument();
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

  it('round-trips anchor metadata from the registry onto the scorecard', async () => {
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

    render(<ScorecardCard anchorId="meta.anchor" window="30d" />);

    expect(await screen.findByText('Fill rate')).toBeInTheDocument();
    expect(screen.getByText('Regions')).toBeInTheDocument();
    expect(screen.getByText(/All countries/)).toBeInTheDocument();
    expect(screen.getByText(/Nigerian residents/)).toBeInTheDocument();
    expect(screen.getByText('KYC model')).toBeInTheDocument();
    expect(
      screen.getByText('Anchor-hosted (standard SEP-24 interactive popup)')
    ).toBeInTheDocument();
    expect(screen.getByText('Fees')).toBeInTheDocument();
    expect(screen.getByText('Flat $0.50 USDC + 0.5% spread')).toBeInTheDocument();
  });

  it('omits the metadata section when the anchor has none', async () => {
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
    expect(screen.queryByText('Regions')).not.toBeInTheDocument();
    expect(screen.queryByText('KYC model')).not.toBeInTheDocument();
  });

  it('renders the composite score with a methodology tooltip', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        fill_rate: 95,
        settle_p50: 300,
        settle_p95: 400,
        slippage_p50: 1,
        slippage_p95: 2,
        outcomes_count: 42,
      }),
    });

    const user = userEvent.setup();
    render(<ScorecardCard anchorId="example.anchor" window="30d" />);

    expect(await screen.findByText('Composite score')).toBeInTheDocument();
    // fillRate=0.95, slippage=0.01, settleSeconds=300 (== NORM_SETTLE_SECONDS) => 0.95 * 0.99 / 1
    expect(screen.getByText('0.94')).toBeInTheDocument();

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.tab(); // skip the oracle-tx link (absent here) / focus the info trigger
    expect(screen.getByRole('tooltip')).toHaveTextContent(/composite = fill rate/);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sample size: 42 outcomes');
    expect(screen.getByRole('link', { name: 'Methodology docs' })).toHaveAttribute(
      'href',
      '/methodology'
    );
  });
});
