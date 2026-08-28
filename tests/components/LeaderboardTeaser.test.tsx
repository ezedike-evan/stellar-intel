import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/constants', () => ({
  CORRIDORS: [
    { id: 'usdc-ngn', from: 'USDC', to: 'NGN', countryCode: 'NG', countryName: 'Nigeria' },
    { id: 'usdc-kes', from: 'USDC', to: 'KES', countryCode: 'KE', countryName: 'Kenya' },
  ],
}));

vi.mock('@/hooks/useAnchorRates', () => ({
  useAnchorRates: () => ({
    rates: {
      rates: [
        {
          anchorId: 'a',
          anchorName: 'Anchor A',
          exchangeRate: 1600,
          fee: 1,
          totalReceived: 158000,
          source: 'sep38',
        },
      ],
      bestRateId: 'a',
    },
    isLoading: false,
    error: undefined,
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { LeaderboardTeaser } from '@/components/landing/LeaderboardTeaser';

describe('LeaderboardTeaser', () => {
  it('renders the leaderboard heading and the default corridor', () => {
    render(<LeaderboardTeaser />);
    expect(screen.getByText('Anchor leaderboard')).toBeInTheDocument();
    expect(screen.getByText(/USDC → NGN/)).toBeInTheDocument();
  });

  it('reuses the live Leaderboard component', () => {
    render(<LeaderboardTeaser />);
    expect(screen.getByText('Anchor A')).toBeInTheDocument();
  });

  it('links to the full leaderboard page', () => {
    render(<LeaderboardTeaser />);
    const link = screen.getByRole('link', { name: /See full leaderboard/ });
    expect(link).toHaveAttribute('href', '/anchors');
  });
});
