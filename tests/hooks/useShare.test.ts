import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useShare } from '@/hooks/useShare';

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useShare', () => {
  it('calls navigator.share when the Web Share API is available', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, share: shareMock });

    const { result } = renderHook(() => useShare());
    await act(async () => {
      await result.current.share({ text: 'hello', url: 'https://example.com' });
    });

    expect(shareMock).toHaveBeenCalledWith({ text: 'hello', url: 'https://example.com' });
  });

  it('falls back to clipboard when the Web Share API is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const { result } = renderHook(() => useShare());
    await act(async () => {
      await result.current.share({ text: 'hello', url: 'https://example.com' });
    });

    expect(writeText).toHaveBeenCalledWith('hello https://example.com');
    await waitFor(() => expect(result.current.copied).toBe(true));
  });

  it('does not fall back to clipboard when the user cancels the native share sheet', async () => {
    const abortError = new DOMException('The user aborted a request', 'AbortError');
    const shareMock = vi.fn().mockRejectedValue(abortError);
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { share: shareMock, clipboard: { writeText } });

    const { result } = renderHook(() => useShare());
    await act(async () => {
      await result.current.share({ text: 'hello' });
    });

    expect(writeText).not.toHaveBeenCalled();
  });
});
