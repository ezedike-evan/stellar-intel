import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { useInView } from '@/hooks/useInView';

function TestComponent({ options }: { options?: Parameters<typeof useInView>[0] }) {
  const [ref, inView] = useInView(options);

  return (
    <div ref={ref as React.RefObject<HTMLDivElement | null>} data-testid="target">
      {inView ? 'IN_VIEW' : 'NOT_IN_VIEW'}
    </div>
  );
}

describe('useInView hook', () => {
  let observeMock = vi.fn();
  let unobserveMock = vi.fn();
  let disconnectMock = vi.fn();
  let observerCallback: ((entries: { isIntersecting: boolean }[]) => void) | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    observeMock = vi.fn();
    unobserveMock = vi.fn();
    disconnectMock = vi.fn();
    observerCallback = null;

    class MockIntersectionObserver {
      observe = observeMock;
      unobserve = unobserveMock;
      disconnect = disconnectMock;

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

  it('initializes as not in view and starts observing', () => {
    render(<TestComponent />);

    expect(screen.getByTestId('target')).toHaveTextContent('NOT_IN_VIEW');
    expect(observeMock).toHaveBeenCalled();
  });

  it('switches to in view when the element intersects', () => {
    render(<TestComponent />);

    act(() => {
      observerCallback?.([{ isIntersecting: true }]);
    });

    expect(screen.getByTestId('target')).toHaveTextContent('IN_VIEW');
  });

  it('stops observing after the first intersection when triggerOnce is true', () => {
    render(<TestComponent options={{ triggerOnce: true }} />);

    act(() => {
      observerCallback?.([{ isIntersecting: true }]);
    });

    expect(unobserveMock).toHaveBeenCalled();
  });

  it('keeps observing and toggles visibility when triggerOnce is false', () => {
    render(<TestComponent options={{ triggerOnce: false }} />);

    act(() => {
      observerCallback?.([{ isIntersecting: true }]);
    });
    expect(screen.getByTestId('target')).toHaveTextContent('IN_VIEW');

    act(() => {
      observerCallback?.([{ isIntersecting: false }]);
    });
    expect(screen.getByTestId('target')).toHaveTextContent('NOT_IN_VIEW');
  });

  it('skips the observer when reduced motion is preferred', () => {
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

    render(<TestComponent />);

    expect(screen.getByTestId('target')).toHaveTextContent('IN_VIEW');
    expect(observeMock).not.toHaveBeenCalled();
  });
});
