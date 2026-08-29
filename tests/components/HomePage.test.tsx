import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import HomePage from '@/app/page';

vi.mock('@/constants', () => ({
  KNOWN_ANCHORS: [{ id: 'anchor-a' }, { id: 'anchor-b' }, { id: 'anchor-c' }],
  ANCHORS: [
    { id: 'anchor-a', name: 'Anchor A', homeDomain: 'anchor-a.example', corridors: [] },
    { id: 'anchor-b', name: 'Anchor B', homeDomain: 'anchor-b.example', corridors: [] },
    { id: 'anchor-c', name: 'Anchor C', homeDomain: 'anchor-c.example', corridors: [] },
  ],
  CORRIDORS: [
    { id: 'usdc-ngn', from: 'USDC', to: 'NGN', countryCode: 'NG', countryName: 'Nigeria' },
    { id: 'usdc-kes', from: 'USDC', to: 'KES', countryCode: 'KE', countryName: 'Kenya' },
  ],
  registryStats: () => ({ anchors: 3, corridors: 2, countries: 2 }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/hooks/useAnchorRates', () => ({
  useAnchorRates: () => ({
    rates: {
      rates: [
        {
          anchorId: 'anchor-a',
          anchorName: 'Anchor A',
          exchangeRate: 1600,
          fee: 1,
          totalReceived: 158000,
          source: 'sep38',
          // Fixed rather than relative to Date.now(): the test suite freezes
          // system time to 2026-01-01T00:00:00Z, so this must stay in sync
          // with that value to keep the QuotePill countdown deterministic.
          expiresAt: new Date('2026-01-01T00:01:00Z'),
        },
      ],
      bestRateId: 'anchor-a',
    },
    isLoading: false,
    error: undefined,
  }),
}));

describe('HomePage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders health-monitor hero copy', () => {
    const { getByRole } = render(<HomePage />);
    const heading = getByRole('heading', { level: 1 });
    // The hero states the declaration/observation gap directly rather than
    // describing the category.
    expect(heading.textContent).toContain('What anchors say.');
    expect(heading.textContent).toContain('What anchors did.');
  });

  it('subcopy leads with the probe/reputation framing', () => {
    const { getByText } = render(<HomePage />);
    expect(getByText(/seven registered off-ramp anchors, probed on a clock/i)).toBeTruthy();
  });

  it('keeps no intent framing above the fold', () => {
    const { getByRole, getByText } = render(<HomePage />);
    expect(getByRole('heading', { level: 1 }).textContent).not.toMatch(/intent/i);
    expect(
      getByText(/seven registered off-ramp anchors, probed on a clock/i).textContent
    ).not.toMatch(/intent/i);
  });

  it('keeps the intent framing further down the page', () => {
    const { getByText } = render(<HomePage />);
    expect(getByText(/sign a single intent in freighter/i)).toBeTruthy();
  });

  it('off-ramp card is the primary CTA and links to /offramp', () => {
    const { getByRole } = render(<HomePage />);
    // The Hero now also renders an "Off-ramp now" CTA to the same route, so
    // match on the card's distinguishing body copy rather than "off-ramp"
    // alone to keep this query unambiguous.
    const link = getByRole('link', { name: /route a usdc off-ramp to the cheapest anchor/i });
    expect(link).toBeTruthy();
    expect((link as HTMLAnchorElement).href).toContain('/offramp');
  });

  it('renders valid FinancialProduct JSON-LD structured data', () => {
    const { container } = render(<HomePage />);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const data = JSON.parse(script!.textContent ?? '{}');
    expect(data['@context']).toBe('https://schema.org');
    expect(data['@type']).toBe('FinancialProduct');
    expect(data.name).toBe('Stellar Intel');
    expect(typeof data.url).toBe('string');
  });

  it('matches snapshot', () => {
    const { container } = render(<HomePage />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
