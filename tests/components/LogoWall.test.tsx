import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/constants', () => ({
  ANCHORS: [
    { id: 'moneygram', name: 'MoneyGram', homeDomain: 'stellar.moneygram.com', corridors: [] },
    { id: 'anclap', name: 'Anclap', homeDomain: 'anclap.com', corridors: [] },
  ],
}));

import { LogoWall } from '@/components/landing/LogoWall';

describe('LogoWall', () => {
  it('renders one entry per registered anchor', () => {
    render(<LogoWall />);
    expect(screen.getByText('MoneyGram')).toBeInTheDocument();
    expect(screen.getByText('Anclap')).toBeInTheDocument();
  });

  it('renders an AnchorLogo (with built-in initials fallback) per anchor', () => {
    render(<LogoWall />);
    expect(screen.getByAltText('MoneyGram logo')).toBeInTheDocument();
    expect(screen.getByAltText('Anclap logo')).toBeInTheDocument();
  });

  it('exposes the wall as a labeled landmark', () => {
    render(<LogoWall />);
    expect(screen.getByLabelText('Supported anchors')).toBeInTheDocument();
  });
});
