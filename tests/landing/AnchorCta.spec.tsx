import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AnchorCta } from '@/components/landing/AnchorCta';

describe('AnchorCta', () => {
  it('matches the visual snapshot', () => {
    const { container } = render(<AnchorCta />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
