import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { useAnchorRates } from '@/hooks/useAnchorRates';
import type { AnchorCapabilities, RateComparison } from '@/types';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  createElement(SWRConfig, { value: { provider: () => new Map() } }, children);

const mockCapabilities = (sep24: boolean, sep38: boolean): AnchorCapabilities => ({
  sep10: true,
  sep24,
  sep38,
  sep12: true,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('capability gating in useAnchorRates', () => {
  it('short-circuits when neither sep24 nor sep38 is true', async () => {
    const fetchSpy = vi.stubGlobal('fetch', vi.fn());
    const capabilities = mockCapabilities(false, false);

    const { result } = renderHook(() => useAnchorRates('usdc-ngn', '100', capabilities), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.source).toBe('unavailable');
    expect(result.current.rates).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches when sep24 is true (but sep38 is false)', async () => {
    const fetchSpy = vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ rates: {} }) }))
    );
    const capabilities = mockCapabilities(true, false);

    renderHook(() => useAnchorRates('usdc-ngn', '100', capabilities), { wrapper });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });

  it('fetches when sep38 is true (but sep24 is false)', async () => {
    const fetchSpy = vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ rates: {} }) }))
    );
    const capabilities = mockCapabilities(false, true);

    renderHook(() => useAnchorRates('usdc-ngn', '100', capabilities), { wrapper });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });

  it('fetches when both sep24 and sep38 are true', async () => {
    const fetchSpy = vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ rates: {} }) }))
    );
    const capabilities = mockCapabilities(true, true);

    renderHook(() => useAnchorRates('usdc-ngn', '100', capabilities), { wrapper });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });
});
