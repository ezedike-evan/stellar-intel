import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnchorCta } from '@/components/landing/AnchorCta';

describe('AnchorCta', () => {
  it('renders a "List your anchor" CTA linking to the onboarding template', () => {
    render(<AnchorCta />);

    const cta = screen.getByRole('link', { name: /list your anchor/i });
    const href = cta.getAttribute('href') ?? '';

    expect(href).toContain('/issues/new');
    expect(href).toContain('template=anchor-onboard.yml');
  });

  it('opens the onboarding form in a new tab without leaking the opener', () => {
    render(<AnchorCta />);

    const cta = screen.getByRole('link', { name: /list your anchor/i });
    expect(cta.getAttribute('target')).toBe('_blank');
    expect(cta.getAttribute('rel') ?? '').toContain('noopener');
  });

  it('uses carrot-not-stick framing', () => {
    render(<AnchorCta />);

    expect(screen.getByText(/carrot, not stick/i)).toBeInTheDocument();
    expect(screen.getByText(/no listing fee/i)).toBeInTheDocument();
  });
});
