import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TrustBar, formatFreshness, isStale } from '@/components/offramp/TrustBar';
import { ANCHORS } from '@/constants/anchors';

const NOW = 1_800_000_000_000;

describe('formatFreshness', () => {
  it('says so plainly before the first fetch', () => {
    expect(formatFreshness(null, NOW)).toBe('not yet loaded');
  });

  it('reads as "just now" only under ten seconds', () => {
    expect(formatFreshness(NOW - 3_000, NOW)).toBe('just now');
    expect(formatFreshness(NOW - 9_999, NOW)).toBe('just now');
    expect(formatFreshness(NOW - 10_000, NOW)).toBe('10s ago');
  });

  it('switches to minutes at the minute boundary', () => {
    expect(formatFreshness(NOW - 59_000, NOW)).toBe('59s ago');
    expect(formatFreshness(NOW - 60_000, NOW)).toBe('1m ago');
    expect(formatFreshness(NOW - 185_000, NOW)).toBe('3m ago');
  });
});

describe('isStale', () => {
  it('is never stale before the first fetch — it is absent, not old', () => {
    expect(isStale(null, NOW)).toBe(false);
  });

  it('turns over at two minutes', () => {
    expect(isStale(NOW - 119_000, NOW)).toBe(false);
    expect(isStale(NOW - 121_000, NOW)).toBe(true);
  });
});

describe('TrustBar', () => {
  it('is a labelled landmark containing a list', () => {
    render(<TrustBar lastFetchedAt={NOW} />);
    const region = screen.getByRole('region', { name: 'Trust and transparency' });
    expect(within(region).getByRole('list')).toBeInTheDocument();
    expect(within(region).getAllByRole('listitem')).toHaveLength(3);
  });

  it('states non-custody in the user’s terms and links the doc', () => {
    render(<TrustBar lastFetchedAt={NOW} />);
    expect(screen.getByText(/You sign every transaction with your own wallet/)).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'How it works' });
    // docs/NON_CUSTODY.md has no route in app/, so this must point at the file
    // on GitHub rather than at a page that would 404.
    expect(link).toHaveAttribute('href', expect.stringContaining('docs/NON_CUSTODY.md'));
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('reports the real anchor count, not a hardcoded one', () => {
    render(<TrustBar lastFetchedAt={NOW} />);
    expect(screen.getByText(`${ANCHORS.length} anchors monitored`)).toBeInTheDocument();
  });

  it('links the methodology behind the scores', () => {
    render(<TrustBar lastFetchedAt={NOW} />);
    expect(screen.getByRole('link', { name: 'Methodology' })).toHaveAttribute(
      'href',
      '/methodology'
    );
  });

  it('makes no claim the repo cannot back', () => {
    const { container } = render(<TrustBar lastFetchedAt={NOW} />);
    const text = container.textContent ?? '';
    // No audit has been performed, and an uptime percentage over a short probe
    // window would be a number dressed as evidence (#791 requirement 2).
    expect(text).not.toMatch(/audit/i);
    expect(text).not.toMatch(/\d+(\.\d+)?%\s*uptime/i);
    expect(text).not.toMatch(/guarantee/i);
    expect(text).not.toMatch(/insured/i);
  });

  it('marks rates as possibly out of date once stale', () => {
    render(<TrustBar lastFetchedAt={Date.now() - 300_000} />);
    expect(screen.getByText(/may be out of date/)).toBeInTheDocument();
  });

  it('says nothing about staleness when the data is fresh', () => {
    render(<TrustBar lastFetchedAt={Date.now() - 1_000} />);
    expect(screen.queryByText(/may be out of date/)).not.toBeInTheDocument();
  });

  it('renders before the first fetch without a bogus timestamp', () => {
    render(<TrustBar lastFetchedAt={null} />);
    const time = screen.getByTestId('trust-freshness');
    expect(time).toHaveTextContent('not yet loaded');
    expect(time).not.toHaveAttribute('dateTime');
  });
});
