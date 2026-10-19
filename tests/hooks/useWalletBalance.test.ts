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
  vi.clearAllMocks();
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

  it('parses the USDC balance by default from the account response', async () => {
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

  it('returns null when the account has no USDC trustline by default', async () => {
    vi.mocked(fetchAccount).mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '10.0000000' }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const { result } = renderHook(() => useWalletBalance('GABC123'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toBeNull();
  });

  it('picks the ARST line for an ARST issuer asset', async () => {
    const arstIssuer = 'GD76B36XOOH432PICDIVEOD4RU7TEFJ5DZVA2C5MW5LKTSCARK45V3DB';
    vi.mocked(fetchAccount).mockResolvedValue({
      balances: [
        {
          asset_type: 'credit_alphanum4',
          asset_code: USDC_ASSET.code,
          asset_issuer: USDC_ASSET.issuer,
          balance: '243.5000000',
        },
        {
          asset_type: 'credit_alphanum4',
          asset_code: 'ARST',
          asset_issuer: arstIssuer,
          balance: '1500.2500000',
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const { result } = renderHook(
      () => useWalletBalance('GABC123', { code: 'ARST', issuer: arstIssuer }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toBe(1500.25);
  });

  it('ignores a same-code line with a different issuer', async () => {
    const targetIssuer = 'GCYE7C77EB5AWAA25R5XMWNI2EDOKTTFTTPZKM2SR5DI4B4WFD52DARS';
    const otherIssuer = 'GBHA4FGPHX7KURMP7CZU7SQ2UOAGTAQ22SCHPK5P5XCQHZXCSVXQJFYB';
    vi.mocked(fetchAccount).mockResolvedValue({
      balances: [
        {
          asset_type: 'credit_alphanum4',
          asset_code: 'ARST',
          asset_issuer: otherIssuer,
          balance: '50.0000000',
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const { result } = renderHook(
      () => useWalletBalance('GABC123', { code: 'ARST', issuer: targetIssuer }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toBeNull();
  });

  it('reads the native line when asset.issuer is null', async () => {
    vi.mocked(fetchAccount).mockResolvedValue({
      balances: [
        { asset_type: 'native', balance: '98.7654321' },
        {
          asset_type: 'credit_alphanum4',
          asset_code: USDC_ASSET.code,
          asset_issuer: USDC_ASSET.issuer,
          balance: '100.0000000',
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const { result } = renderHook(
      () => useWalletBalance('GABC123', { code: 'XLM', issuer: null }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toBe(98.7654321);
  });

  it('returns null when the account has no trustline for the requested asset', async () => {
    vi.mocked(fetchAccount).mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '50.0000000' }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const { result } = renderHook(
      () =>
        useWalletBalance('GABC123', {
          code: 'NGNT',
          issuer: 'GAWODDEFGH1234567890123456789012345678901234567890123456',
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toBeNull();
  });
});
