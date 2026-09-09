import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { existsSync } from 'fs';
import { join } from 'path';
import { Footer } from '@/components/layout/Footer';

// #740 — app/terms/page.tsx existed but nothing linked to it, so the Terms were
// reachable only by typing the URL. A legal page nobody can find is not a legal
// page.

describe('Footer legal links (#740)', () => {
  it('links to the Terms page', () => {
    render(<Footer />);
    const terms = screen.getByRole('link', { name: /terms/i });
    expect(terms).toHaveAttribute('href', '/terms');
  });

  it('links to the FAQ page', () => {
    render(<Footer />);
    const faq = screen.getByRole('link', { name: /^faq$/i });
    expect(faq).toHaveAttribute('href', '/faq');
    expect(faq).not.toHaveAttribute('target', '_blank');
  });

  it('renders Terms as an internal link, not an external one', () => {
    render(<Footer />);
    const terms = screen.getByRole('link', { name: /terms/i });
    // An internal page opened via target="_blank" to GitHub would defeat the
    // point — the page is in the app.
    expect(terms).not.toHaveAttribute('target', '_blank');
  });

  it('every internal footer link resolves to a real route', () => {
    render(<Footer />);
    const internal = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href') ?? '')
      .filter((href) => href.startsWith('/'));

    expect(internal.length).toBeGreaterThan(0);

    for (const href of internal) {
      // Guards the opposite failure to #740: a footer link to a page that does
      // not exist, which only shows up as a 404 in production.
      const routeDir = join('app', href.replace(/^\//, ''));
      expect(
        existsSync(join(routeDir, 'page.tsx')) || existsSync(join(routeDir, 'page.ts')),
        `Footer links to ${href} but ${routeDir}/page.tsx does not exist`
      ).toBe(true);
    }
  });
});
