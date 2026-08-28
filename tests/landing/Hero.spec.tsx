import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/hooks/useAnchorRates', () => ({
  useAnchorRates: () => ({
    rates: {
      bestRateId: 'cowrie',
      rates: [
        {
          anchorId: 'cowrie',
          anchorName: 'Cowrie Exchange',
          exchangeRate: 1580,
          totalReceived: 154840,
          source: 'sep24-fee',
        },
        {
          anchorId: 'moneygram',
          anchorName: 'MoneyGram',
          exchangeRate: 1560,
          totalReceived: 153200,
          source: 'sep24-fee',
        },
      ],
    },
    isLoading: false,
  }),
}));

import { Hero } from '@/components/landing/Hero';

describe('Hero', () => {
  it('matches the visual snapshot with live rate + leaderboard data', () => {
    const { container } = render(<Hero />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
