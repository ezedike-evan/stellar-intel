import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/onramp' }));

import { BottomNav } from '@/components/layout/BottomNav';

describe('BottomNav (#1482)', () => {
  it('links to the On-ramp page and marks it as the current tab', () => {
    render(<BottomNav />);

    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/offramp', '/onramp', '/anchors']);
    expect(screen.getByRole('link', { name: /on-ramp/i })).toHaveAttribute('href', '/onramp');
  });
});
