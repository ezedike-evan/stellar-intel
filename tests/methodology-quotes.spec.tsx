import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import MethodologyPage from '@/app/methodology/page';
import { MIN_RECEIVE_TOLERANCE } from '@/lib/rate-ranking';
import { MAX_SPREAD_RATIO } from '@/lib/fx/reference-mid';

describe('Methodology page — quotes and estimates (#1517)', () => {
  it('renders the quotes, estimates and what actually lands heading', () => {
    const { getByRole } = render(<MethodologyPage />);

    expect(
      getByRole('heading', { level: 2, name: 'Quotes, estimates and what actually lands' })
    ).toBeDefined();
  });

  it('states the constants as they exist in code', () => {
    const { container } = render(<MethodologyPage />);
    const text = container.textContent ?? '';

    expect(text).toContain('MIN_RECEIVE_TOLERANCE');
    expect(text).toContain(`${MIN_RECEIVE_TOLERANCE * 100}%`);
    expect(text).toContain(`${MAX_SPREAD_RATIO * 100}%`);
  });
});
