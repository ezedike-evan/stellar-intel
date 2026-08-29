import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// The real hook animates via requestAnimationFrame, which is non-deterministic
// for a snapshot — return the target value immediately instead.
vi.mock('@/hooks/useCountUp', () => ({
  useCountUp: ({ end }: { end: number }) => end,
}));

import { StatBar } from '@/components/landing/StatBar';

describe('StatBar', () => {
  it('matches the visual snapshot for a row of stats', () => {
    const { container } = render(
      <StatBar
        stats={[
          { icon: <span data-testid="icon-anchors" />, value: 9, label: 'Anchors tracked' },
          { icon: <span data-testid="icon-corridors" />, value: 9, label: 'Corridors live' },
          { icon: <span data-testid="icon-countries" />, value: 7, label: 'Countries reachable' },
        ]}
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});
