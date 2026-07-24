import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountdown } from '@/hooks/useCountdown';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCountdown', () => {
  it('starts at the full duration and ticks down once per second', () => {
    const { result } = renderHook(() => useCountdown(30_000, 'key-1'));
    expect(result.current.secondsRemaining).toBe(30);
    expect(result.current.progress).toBe(0);
    expect(result.current.totalSeconds).toBe(30);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.secondsRemaining).toBe(25);
    expect(result.current.elapsedSeconds).toBe(5);
    expect(result.current.progress).toBeCloseTo(5 / 30, 2);
  });

  it('clamps at 0 once the duration has fully elapsed', () => {
    const { result } = renderHook(() => useCountdown(3_000, 'key-1'));

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.secondsRemaining).toBe(0);
  });

  it('restarts from the full duration when resetKey changes', () => {
    const { result, rerender } = renderHook(({ resetKey }) => useCountdown(30_000, resetKey), {
      initialProps: { resetKey: 'key-1' },
    });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.secondsRemaining).toBe(20);

    act(() => {
      rerender({ resetKey: 'key-2' });
    });
    expect(result.current.secondsRemaining).toBe(30);
  });
});
