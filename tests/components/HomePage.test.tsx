import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import HomePage from '@/app/page';

vi.mock('@/constants', () => ({
  KNOWN_ANCHORS: [{ id: 'anchor-a' }, { id: 'anchor-b' }, { id: 'anchor-c' }],
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
    expect(heading.textContent).toContain('Where stablecoin transactions');
    expect(heading.textContent).toContain('happen on Stellar.');
  });

  it('subcopy references the execution layer', () => {
    const { getByText } = render(<HomePage />);
    expect(getByText(/execution layer for cross-border stablecoin flows/i)).toBeTruthy();
  });

  it('off-ramp card is the primary CTA and links to /offramp', () => {
    const { getByRole } = render(<HomePage />);
    const link = getByRole('link', { name: /off-ramp/i });
    expect(link).toBeTruthy();
    expect((link as HTMLAnchorElement).href).toContain('/offramp');
  });

  it('matches snapshot', () => {
    const { container } = render(<HomePage />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
