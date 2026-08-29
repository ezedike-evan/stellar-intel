import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { useWalletBalance } from '@/hooks/useWalletBalance';
import { USDC_ASSET } from '@/constants/anchors';

vi.mock('@/lib/stellar/horizon', () => ({
  fetchAccount: vi.fn(),
}));

const { fetchAccount } = await import('@/lib/stellar/horizon');

// Fresh SWR cache per test — prevents cross-test cache pollution
const wrapper = ({ children }: { children: React.ReactNode }) =>
  createElement(SWRConfig, { value: { provider: () => new Map() } }, children);

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useWalletBalance', () => {
  it('returns null balance when publicKey is null (no fetch)', () => {
    const { result } = renderHook(() => useWalletBalance(null), { wrapper });
    expect(result.current.balance).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(fetchAccount).not.toHaveBeenCalled();
  });

  it('parses the USDC balance from the account response', async () => {
    vi.mocked(fetchAccount).mockResolvedValue({
      balances: [
        { asset_type: 'native', balance: '10.0000000' },
        {
          asset_type: 'credit_alphanum4',
          asset_code: USDC_ASSET.code,
          asset_issuer: USDC_ASSET.issuer,
          balance: '243.5000000',
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const { result } = renderHook(() => useWalletBalance('GABC123'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toBe(243.5);
  });

  it('returns null when the account has no USDC trustline', async () => {
    vi.mocked(fetchAccount).mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '10.0000000' }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const { result } = renderHook(() => useWalletBalance('GABC123'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toBeNull();
  });
});
