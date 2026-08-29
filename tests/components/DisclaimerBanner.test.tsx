import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { DisclaimerBanner } from '@/components/offramp/DisclaimerBanner';

const STORAGE_KEY = 'offramp-disclaimer-dismissed-at';

beforeEach(() => {
  localStorage.clear();
});

describe('DisclaimerBanner', () => {
  it('shows the banner on first visit', async () => {
    render(<DisclaimerBanner />);
    await waitFor(() => {
      expect(screen.getByText(/Stellar Intel is non-custodial/)).toBeInTheDocument();
    });
  });

  it('hides the banner and persists dismissal when the dismiss button is clicked', async () => {
    render(<DisclaimerBanner />);
    await waitFor(() => {
      expect(screen.getByText(/Stellar Intel is non-custodial/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss disclaimer' }));

    expect(screen.queryByText(/Stellar Intel is non-custodial/)).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('stays hidden on a later visit within 30 days of dismissal', async () => {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    render(<DisclaimerBanner />);
    await waitFor(() => {
      expect(screen.queryByText(/Stellar Intel is non-custodial/)).not.toBeInTheDocument();
    });
  });

  it('reappears after 30 days', async () => {
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    localStorage.setItem(STORAGE_KEY, String(thirtyOneDaysAgo));
    render(<DisclaimerBanner />);
    await waitFor(() => {
      expect(screen.getByText(/Stellar Intel is non-custodial/)).toBeInTheDocument();
    });
  });
});
