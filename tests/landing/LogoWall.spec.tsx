import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/constants', () => ({
  ANCHORS: [
    { id: 'moneygram', name: 'MoneyGram', homeDomain: 'stellar.moneygram.com', corridors: [] },
    { id: 'anclap', name: 'Anclap', homeDomain: 'anclap.com', corridors: [] },
  ],
}));

import { LogoWall } from '@/components/landing/LogoWall';

describe('LogoWall', () => {
  it('matches the visual snapshot for a fixed anchor list', () => {
    const { container } = render(<LogoWall />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
