import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RateTableHeader } from '@/components/offramp/RateTableHeader';

describe('RateTableHeader', () => {
  const baseProps = {
    respondingCount: 3,
    totalCount: 5,
    lastFetchedAt: Date.now() as number | null,
    secondsRemaining: 25,
    elapsedSeconds: 5,
    prefersReducedMotion: false,
    progress: 5 / 30,
    totalSeconds: 30,
    refreshInflight: false,
    onRefresh: vi.fn(),
  };

  it('renders the title and anchor count badge', () => {
    render(<RateTableHeader {...baseProps} />);
    expect(screen.getByText('Available Rates')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders the countdown text and progress bar', () => {
    render(<RateTableHeader {...baseProps} />);
    expect(screen.getByText(/Rates refresh in ~25s/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('hides countdown when lastFetchedAt is null (before first fetch)', () => {
    render(<RateTableHeader {...baseProps} lastFetchedAt={null} />);
    expect(screen.queryByText(/Rates refresh in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Last updated/)).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows reduced-motion fallback "Last updated Xs ago"', () => {
    render(<RateTableHeader {...baseProps} prefersReducedMotion={true} />);
    expect(screen.getByText('Last updated 5s ago')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('calls onRefresh when refresh button is clicked', () => {
    const onRefresh = vi.fn();
    render(<RateTableHeader {...baseProps} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh rates' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows refreshing state on the button when refreshInflight is true', () => {
    render(<RateTableHeader {...baseProps} refreshInflight={true} />);
    const btn = screen.getByRole('button', { name: 'Refreshing rates...' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('progress bar width is computed correctly from progress ratio', () => {
    render(<RateTableHeader {...baseProps} secondsRemaining={15} progress={15 / 30} totalSeconds={30} />);
    const inner = screen.getByRole('progressbar').firstChild as HTMLElement;
    expect(inner.style.width).toBe('50%');
  });

  it('progress bar aria-valuenow reflects seconds remaining', () => {
    render(<RateTableHeader {...baseProps} secondsRemaining={15} progress={15 / 30} totalSeconds={30} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '15');
  });

  it('progress bar clamps width at 0% when fully expired', () => {
    render(<RateTableHeader {...baseProps} secondsRemaining={0} progress={1} />);
    const inner = screen.getByRole('progressbar').firstChild as HTMLElement;
    expect(inner.style.width).toBe('0%');
  });
});
