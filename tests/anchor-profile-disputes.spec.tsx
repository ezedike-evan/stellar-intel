import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnchorProfile, type AnchorProfileData } from '@/components/offramp/AnchorProfile';
import type { PublicDisputeItem } from '@/lib/reputation/disputes';

function profile(disputes: PublicDisputeItem[]): AnchorProfileData {
  return {
    id: 'moneygram',
    name: 'MoneyGram',
    homeDomain: 'stellar.moneygram.com',
    score: null,
    sampleSize: 0,
    corridors: [],
    history: [],
    disputes,
    oracleTxId: null,
    refunds: null,
  };
}

describe('AnchorProfile disputes (DSP010)', () => {
  it('says there are no disputes when the list is empty', () => {
    render(<AnchorProfile data={profile([])} />);
    expect(screen.getByText('No disputes on record.')).toBeTruthy();
  });

  it('renders each dispute with its category label and status', () => {
    render(
      <AnchorProfile
        data={profile([
          {
            id: '0123456789abcdef',
            createdAt: '2026-11-01T00:00:00.000Z',
            reason: 'Funds not received',
            status: 'open',
          },
          {
            id: 'fedcba9876543210',
            createdAt: '2026-10-01T00:00:00.000Z',
            reason: 'Unreasonable delay',
            status: 'resolved',
          },
        ])}
      />
    );
    expect(screen.getByText('Funds not received')).toBeTruthy();
    expect(screen.getByText('Unreasonable delay')).toBeTruthy();
    expect(screen.getByText('open')).toBeTruthy();
    expect(screen.getByText('resolved')).toBeTruthy();
  });

  it('links to the full dispute log', () => {
    render(<AnchorProfile data={profile([])} />);
    const link = screen.getByRole('link', { name: 'Full dispute log' });
    expect(link.getAttribute('href')).toBe('/disputes');
  });
});
