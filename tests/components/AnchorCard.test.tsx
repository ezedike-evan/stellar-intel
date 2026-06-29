import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnchorCard } from '@/components/anchors/AnchorCard';
import type { Anchor } from '@/types';

function makeAnchor(seps: NonNullable<Anchor['seps']>): Anchor {
  return {
    id: 'test-anchor',
    name: 'Test Anchor',
    homeDomain: 'test.example.com',
    corridors: [],
    assetCode: 'USDC',
    assetIssuer: 'GTEST',
    seps,
  };
}

describe('AnchorCard', () => {
  it('renders a SEP-31 badge when the anchor advertises sep31', () => {
    render(<AnchorCard anchor={makeAnchor(['sep24', 'sep31', 'sep38'])} />);

    expect(screen.getByText('SEP-31')).toBeInTheDocument();
    expect(screen.getByText('SEP-24')).toBeInTheDocument();
    expect(screen.getByText('Firm quotes')).toBeInTheDocument();
  });

  it('omits SEP-31 when the anchor does not advertise it', () => {
    render(<AnchorCard anchor={makeAnchor(['sep24'])} />);

    expect(screen.queryByText('SEP-31')).not.toBeInTheDocument();
    expect(screen.getByText('SEP-24')).toBeInTheDocument();
  });
});
