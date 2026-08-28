import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ComparisonTeaser } from '@/components/landing/ComparisonTeaser';

describe('ComparisonTeaser', () => {
  it('matches the visual snapshot (static sample data)', () => {
    const { container } = render(<ComparisonTeaser />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
