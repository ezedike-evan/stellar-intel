import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import HomePage from '@/app/page';
import AnchorsPage from '@/app/anchors/page';
import OfframpPage from '@/app/offramp/page';
import AdminDisputesPage from '@/app/admin/disputes/page';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/constants')>();
  return {
    ...actual,
    CORRIDORS: [
      { id: 'usdc-ngn', from: 'USDC', to: 'NGN', countryCode: 'NG', countryName: 'Nigeria' },
      { id: 'usdc-kes', from: 'USDC', to: 'KES', countryCode: 'KE', countryName: 'Kenya' },
    ],
    KNOWN_ANCHORS: [{ id: 'anchor-a' }, { id: 'anchor-b' }, { id: 'anchor-c' }],
  };
});

vi.mock('@/hooks/useAnchorRates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useAnchorRates')>();
  return {
    ...actual,
    useAnchorRates: () => ({
      rates: { rates: [], pending: [], bestRateId: null },
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
      refreshInflight: false,
      pauseRefresh: vi.fn(),
      resumeRefresh: vi.fn(),
      anchorErrors: [],
      lastFetchedAt: null,
    }),
  };
});

vi.mock('@/hooks/useWithdrawStatus', () => ({
  useWithdrawStatus: () => ({
    status: null,
    amountIn: null,
    amountInAsset: null,
    amountOut: null,
    amountOutAsset: null,
    amountFee: null,
    currencyCode: null,
    stellarTransactionId: null,
    externalTransactionId: null,
    refunds: [],
    isLoading: false,
    error: undefined,
  }),
}));

vi.mock('@/contexts/WalletContext', () => ({
  useWallet: () => ({
    isConnected: false,
    publicKey: null,
    network: 'PUBLIC',
  }),
}));

vi.mock('@/components/ui/WalletButton', () => ({
  WalletButton: () => <button type="button">Connect wallet</button>,
}));

vi.mock('@/components/ui/AmountInput', () => ({
  AmountInput: () => <div>Amount input</div>,
}));

vi.mock('@/components/ui/CorridorSelector', () => ({
  CorridorSelector: () => <div>Corridor selector</div>,
}));

vi.mock('@/components/offramp/RateTable', () => ({
  RateTable: () => <div>Rate table</div>,
}));

vi.mock('@/components/offramp/ExecuteDrawer', () => ({
  ExecuteDrawer: () => null,
}));

vi.mock('@/components/offramp/StatusTracker', () => ({
  StatusTracker: () => <div>Status tracker</div>,
}));

vi.mock('@/components/offramp/Leaderboard', () => ({
  Leaderboard: () => <div>Leaderboard table</div>,
}));

function collectHeadingLevels(container: HTMLElement) {
  return Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((heading) => {
    const tagName = heading.tagName.toLowerCase();
    const level = Number.parseInt(tagName.replace('h', ''), 10);
    return level;
  });
}

describe('Route heading hierarchy', () => {
  const pages = [
    ['home', <HomePage key="home" />],
    ['anchors', <AnchorsPage key="anchors" />],
    ['offramp', <OfframpPage key="offramp" />],
    ['admin disputes', <AdminDisputesPage key="admin" />],
  ] as const;

  it.each(pages)('%s page has a single h1 and no skipped heading levels', (_, PageComponent) => {
    const { container } = render(PageComponent);
    const headingLevels = collectHeadingLevels(container);

    expect(headingLevels.filter((level) => level === 1)).toHaveLength(1);

    for (let index = 1; index < headingLevels.length; index += 1) {
      const previous = headingLevels[index - 1];
      const current = headingLevels[index];
      expect(current - previous).toBeLessThanOrEqual(1);
    }
  });
});
