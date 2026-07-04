import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { LandingSection } from '@/components/landing/LandingSection';

describe('LandingSection component', () => {
  let observerCallback: ((entries: { isIntersecting: boolean }[]) => void) | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    observerCallback = null;

    class MockIntersectionObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();

      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        observerCallback = callback;
      }
    }

    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    );
  });

  it('renders children inside a section and starts hidden', () => {
    render(
      <LandingSection data-testid="landing-section">
        <div>Content</div>
      </LandingSection>
    );

    const section = screen.getByTestId('landing-section');
    expect(section.tagName).toBe('SECTION');
    expect(section).toHaveTextContent('Content');
    expect(section.className).toContain('opacity-0');
    expect(section.className).toContain('translate-y-8');
  });

  it('applies the visible state once the section intersects', () => {
    render(
      <LandingSection data-testid="landing-section">
        <div>Content</div>
      </LandingSection>
    );

    act(() => {
      observerCallback?.([{ isIntersecting: true }]);
    });

    const section = screen.getByTestId('landing-section');
    expect(section.className).toContain('opacity-100');
    expect(section.className).toContain('translate-y-0');
  });

  it('supports an animation delay prop', () => {
    render(
      <LandingSection data-testid="landing-section" delay={150}>
        <div>Content</div>
      </LandingSection>
    );

    const section = screen.getByTestId('landing-section');
    expect(section.style.transitionDelay).toBe('0ms');

    act(() => {
      observerCallback?.([{ isIntersecting: true }]);
    });

    expect(section.style.transitionDelay).toBe('150ms');
  });

  it('stays fully visible under reduced motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    );

    render(
      <LandingSection data-testid="landing-section">
        <div>Content</div>
      </LandingSection>
    );

    const section = screen.getByTestId('landing-section');
    expect(section.className).toContain('opacity-100');
    expect(section.className).toContain('translate-y-0');
    expect(section.className).toContain('motion-reduce:transition-none');
  });
});
