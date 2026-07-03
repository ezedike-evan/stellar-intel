import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import HomePage from '@/app/page';

vi.mock('@/constants', () => ({
  KNOWN_ANCHORS: [{ id: 'anchor-a' }, { id: 'anchor-b' }, { id: 'anchor-c' }],
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

describe('HomePage', () => {
  it('renders execution-layer hero copy', () => {
    const { getByRole } = render(<HomePage />);
    const heading = getByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('The execution layer for');
    expect(heading.textContent).toContain('stablecoin off-ramps.');
  });

  it('subcopy references the execution layer', () => {
    const { getByText } = render(<HomePage />);
    expect(getByText(/live sep-38 quotes across every stellar anchor/i)).toBeTruthy();
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

  it('matches snapshot', () => {
    const { container } = render(<HomePage />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
