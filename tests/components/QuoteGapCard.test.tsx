import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuoteGapCard } from '@/components/anchors/QuoteGapCard';
import type { QuoteGapStats } from '@/lib/reputation/quote-gap';

const STATS: QuoteGapStats = {
  sampleCount: 42,
  meanGapPct: -0.8,
  p50GapPct: -1.2,
  p95AbsGapPct: 3.456,
  worseCount: 30,
  betterCount: 9,
  windowDays: 30,
};

function line(re: RegExp): HTMLElement {
  return screen.getByText(re, { selector: 'p' });
}

describe('QuoteGapCard (#1501)', () => {
  it('renders the median, the 95% range, the worse/better split and the sample size', () => {
    render(<QuoteGapCard {...STATS} />);

    expect(line(/Median gap between quoted and landed rate/).textContent).toBe(
      'Median gap between quoted and landed rate: -1.20%'
    );
    expect(line(/95% of transactions landed within/).textContent).toBe(
      '95% of transactions landed within 3.46%'
    );
    expect(line(/than quoted/).textContent).toBe('30 worse / 9 better than quoted');
    expect(line(/Based on/).textContent).toBe(
      'Based on 42 completed transactions in the last 30 days'
    );
  });

  it('shows the not-enough-data message and hides every number below five samples', () => {
    render(<QuoteGapCard {...STATS} sampleCount={4} />);

    expect(
      screen.getByText(
        "Not enough completed transactions yet to measure this anchor's quote accuracy."
      )
    ).toBeTruthy();
    expect(screen.queryByText(/Median gap/)).toBeNull();
    expect(screen.queryByText(/landed within/)).toBeNull();
    expect(screen.queryByText(/worse/)).toBeNull();
  });

  it('shows the numbers at exactly five samples', () => {
    render(<QuoteGapCard {...STATS} sampleCount={5} />);
    expect(screen.getByText(/Median gap/)).toBeTruthy();
  });

  it('treats a missing statistic as not enough data, even with samples', () => {
    render(<QuoteGapCard {...STATS} p50GapPct={null} />);
    expect(screen.getByText(/Not enough completed transactions/)).toBeTruthy();
  });

  it('colours a negative median as down and signs it', () => {
    render(<QuoteGapCard {...STATS} p50GapPct={-1.2} />);
    const value = screen.getByText('-1.20%');
    expect(value.className).toContain('text-status-down');
  });

  it('colours a positive median as up and signs it', () => {
    render(<QuoteGapCard {...STATS} p50GapPct={0.5} />);
    const value = screen.getByText('+0.50%');
    expect(value.className).toContain('text-status-up');
  });

  it('leaves a zero median neutral', () => {
    render(<QuoteGapCard {...STATS} p50GapPct={0} />);
    const value = screen.getByText('0.00%');
    expect(value.className).not.toContain('text-status-up');
    expect(value.className).not.toContain('text-status-down');
  });

  it('does not show a rounds-to-zero loss as a negative', () => {
    render(<QuoteGapCard {...STATS} p50GapPct={-0.001} />);
    const value = screen.getByText('0.00%');
    expect(value.className).not.toContain('text-status-down');
  });

  it('colours the worse count as down and the better count as up', () => {
    render(<QuoteGapCard {...STATS} />);
    expect(screen.getByText('30 worse').className).toContain('text-status-down');
    expect(screen.getByText('9 better').className).toContain('text-status-up');
  });

  it('is a labelled region', () => {
    render(<QuoteGapCard {...STATS} />);
    expect(screen.getByRole('region', { name: 'Quote accuracy' })).toBeTruthy();
  });
});
