import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnchorCountBadge } from '@/components/offramp/AnchorCountBadge';

describe('AnchorCountBadge', () => {
  it('renders nothing when total is 0', () => {
    const { container } = render(<AnchorCountBadge responding={0} total={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows green styling when all anchors respond', () => {
    render(<AnchorCountBadge responding={5} total={5} />);
    const badge = screen.getByText('5 of 5 anchors responding');
    expect(badge.className).toContain('text-status-up');
  });

  it('shows amber styling when partially responding', () => {
    render(<AnchorCountBadge responding={3} total={5} />);
    const badge = screen.getByText('3 of 5 anchors responding');
    expect(badge.className).toContain('text-status-unknown');
  });

  it('shows red styling when zero anchors respond', () => {
    render(<AnchorCountBadge responding={0} total={5} />);
    const badge = screen.getByText('0 of 5 anchors responding');
    expect(badge.className).toContain('text-status-down');
  });
});
