import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { useDepositRates } from '@/hooks/useDepositRates';

const WIRE = {
  corridorId: 'usdc-ngn',
  direction: 'deposit',
  bestRateId: 'anchor-a',
  rates: [
    {
      anchorId: 'anchor-a',
      anchorName: 'Anchor A',
      corridorId: 'usdc-ngn',
      asset: 'stellar:USDC:GISSUER',
      fiatAmount: 10000,
      fee: 1,
      feeType: 'flat',
      exchangeRate: 0.00064,
      totalReceived: 6.4,
      source: 'sep24-fee',
      updatedAt: '2026-10-25T08:00:00.000Z',
    },
  ],
  errors: [{ anchorId: 'anchor-b', anchorName: 'Anchor B', reason: 'no SEP-24' }],
  indicative: true,
  disclaimer: 'Estimate only.',
};

function stubFetchResolving(body: unknown = WIRE) {
  const fetchMock = vi.fn(
    async () => ({ ok: true, json: async () => body }) as unknown as Response
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// Fresh SWR cache per test, so results never leak between cases.
const wrapper = ({ children }: { children: React.ReactNode }) =>
  createElement(SWRConfig, { value: { provider: () => new Map() } }, children);

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDepositRates (#1475)', () => {
  it('requests the v1 quote URL', async () => {
    const fetchMock = stubFetchResolving();
    const { result } = renderHook(() => useDepositRates('usdc-ngn', '10000'), { wrapper });

    await waitFor(() => expect(result.current.rates).toBeDefined());
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/onramp/quote?corridor=usdc-ngn&amount=10000');
  });

  it('adds the asset to the URL, encoded, when one is given', async () => {
    const fetchMock = stubFetchResolving();
    const asset = 'stellar:USDC:GISSUER';
    const { result } = renderHook(() => useDepositRates('usdc-ngn', '10000', asset), { wrapper });

    await waitFor(() => expect(result.current.rates).toBeDefined());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/onramp/quote?corridor=usdc-ngn&amount=10000&asset=${encodeURIComponent(asset)}`
    );
  });

  it.each(['', '0', '-5', 'abc'])('does not fetch for the amount "%s"', (amount) => {
    const fetchMock = stubFetchResolving();
    const { result } = renderHook(() => useDepositRates('usdc-ngn', amount), { wrapper });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.rates).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('does not fetch without a corridor', () => {
    const fetchMock = stubFetchResolving();
    renderHook(() => useDepositRates(null, '100'), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces per-anchor errors as anchorErrors', async () => {
    stubFetchResolving();
    const { result } = renderHook(() => useDepositRates('usdc-ngn', '10000'), { wrapper });

    await waitFor(() => expect(result.current.rates).toBeDefined());
    expect(result.current.anchorErrors).toEqual(WIRE.errors);
    expect(result.current.rates?.bestRateId).toBe('anchor-a');
  });

  it('revives updatedAt strings into Dates', async () => {
    stubFetchResolving();
    const { result } = renderHook(() => useDepositRates('usdc-ngn', '10000'), { wrapper });

    await waitFor(() => expect(result.current.rates).toBeDefined());
    const updatedAt = result.current.rates!.rates[0]!.updatedAt;
    expect(updatedAt).toBeInstanceOf(Date);
    expect(updatedAt.toISOString()).toBe('2026-10-25T08:00:00.000Z');
  });

  it('records when the last fetch succeeded', async () => {
    stubFetchResolving();
    const { result } = renderHook(() => useDepositRates('usdc-ngn', '10000'), { wrapper });

    expect(result.current.lastFetchedAt).toBeNull();
    await waitFor(() => expect(result.current.lastFetchedAt).not.toBeNull());
  });

  it('reads the message from the v1 error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 400,
            json: async () => ({
              error: { code: 'validation_error', message: 'Unknown corridor' },
            }),
          }) as unknown as Response
      )
    );
    const { result } = renderHook(() => useDepositRates('usdc-ngn', '10000'), { wrapper });

    await waitFor(() => expect(result.current.error).toBe('Unknown corridor'));
    expect(result.current.anchorErrors).toEqual([]);
  });
});
