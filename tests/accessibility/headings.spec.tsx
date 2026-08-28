import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import HomePage from '@/app/page';
import AnchorsPage from '@/app/anchors/page';
import OfframpPage from '@/app/offramp/page';
import AdminDisputesPage from '@/app/admin/disputes/page';

function assertHeadingStructure(container: HTMLElement, routeName: string) {
  const headings = Array.from(container.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLElement[];
  const h1Count = headings.filter((h) => h.tagName === 'H1').length;
  expect(h1Count, `${routeName} should have exactly one <h1>`).toBe(1);

  // Ensure no skipped heading levels: for any heading Hn (n>1), there must be at least one H(n-1)
  headings.forEach((h, idx) => {
    const level = Number(h.tagName.replace('H', ''));
    if (level > 1) {
      const prior = headings.slice(0, idx);
      const hasPrevLevel = prior.some((p) => Number(p.tagName.replace('H', '')) === level - 1);
      expect(hasPrevLevel, `${routeName} has a ${h.tagName} without a preceding H${level - 1}`).toBe(true);
    }
  });
}

describe('Heading order and landmarks', () => {
  it('Home page has a single h1 and no skipped levels', () => {
    const { container } = render(<HomePage />);
    assertHeadingStructure(container, 'Home');
  });

  it('Anchors page has a single h1 and no skipped levels', () => {
    const { container } = render(<AnchorsPage />);
    assertHeadingStructure(container, 'Anchors');
  });

  it('Offramp page has a single h1 and no skipped levels', () => {
    const { container } = render(<OfframpPage />);
    assertHeadingStructure(container, 'Offramp');
  });

  it('Admin disputes page has a single h1 and no skipped levels', () => {
    const { container } = render(<AdminDisputesPage />);
    assertHeadingStructure(container, 'Admin/Disputes');
  });
});
