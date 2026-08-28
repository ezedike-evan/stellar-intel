import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Faq } from '@/components/landing/Faq';

describe('Faq', () => {
  it('matches the visual snapshot in its default (all-closed) state', () => {
    const { container } = render(<Faq />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
