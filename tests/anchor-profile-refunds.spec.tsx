import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { AnchorProfile, type AnchorProfileData } from '@/components/offramp/AnchorProfile';

const BASE_DATA: AnchorProfileData = {
  id: 'my-anchor',
  name: 'My Anchor',
  homeDomain: 'myanchor.com',
  score: 0.95,
  sampleSize: 50,
  corridors: [],
  history: [],
  disputes: [],
  oracleTxId: null,
  refunds: null,
};

describe('AnchorProfile Refunds Section (#2122)', () => {
  it('renders "No refund data." when refunds is null', () => {
    render(<AnchorProfile data={{ ...BASE_DATA, refunds: null }} />);
    expect(screen.getByText('Refunds (90 days)')).toBeDefined();
    expect(screen.getByText('No refund data.')).toBeDefined();
  });

  it('renders refund statistics when present', () => {
    const data: AnchorProfileData = {
      ...BASE_DATA,
      refunds: {
        windowDays: 90,
        total: 10,
        refunded: 7,
        acknowledged: 4,
        overdueOwed: 2,
        medianHoursToRefund: 3.5,
      },
    };

    render(<AnchorProfile data={data} />);
    expect(screen.getByText('Refunds (90 days)')).toBeDefined();
    expect(screen.getByText('7 refunded · 4 confirmed by users · 2 overdue')).toBeDefined();
    expect(screen.getByText('Median time to refund: 3.5 h')).toBeDefined();
  });

  it('omits median line when medianHoursToRefund is null', () => {
    const data: AnchorProfileData = {
      ...BASE_DATA,
      refunds: {
        windowDays: 90,
        total: 2,
        refunded: 0,
        acknowledged: 0,
        overdueOwed: 2,
        medianHoursToRefund: null,
      },
    };

    render(<AnchorProfile data={data} />);
    expect(screen.getByText('0 refunded · 0 confirmed by users · 2 overdue')).toBeDefined();
    expect(screen.queryByText(/Median time to refund:/)).toBeNull();
  });
});
