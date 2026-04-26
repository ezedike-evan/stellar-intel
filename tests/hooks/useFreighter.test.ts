import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFreighter } from '@/hooks/useFreighter';

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  requestAccess: vi.fn(),
}));

async function getApi() {
  return await import('@stellar/freighter-api');
}

beforeEach(async () => {
  vi.clearAllMocks();
  const api = await getApi();
  vi.mocked(api.isConnected).mockResolvedValue({ isConnected: false });
  vi.mocked(api.getAddress).mockResolvedValue({ address: 'GPUBLICKEY' });
  vi.mocked(api.getNetwork).mockResolvedValue({
    network: 'PUBLIC',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
  });
  vi.mocked(api.requestAccess).mockResolvedValue({ address: 'GPUBLICKEY' });
});

describe('useFreighter', () => {
  it('isInstalled is false when isConnected() throws', async () => {
    const api = await getApi();
    vi.mocked(api.isConnected).mockRejectedValue(new Error('Extension not found'));

    const { result } = renderHook(() => useFreighter());
    await waitFor(() => expect(result.current.isInstalled).toBe(false));
  });

  it('isInstalled is true and isConnected is false when extension is present but locked', async () => {
    const { result } = renderHook(() => useFreighter());
    await waitFor(() => expect(result.current.isInstalled).toBe(true));
    expect(result.current.isConnected).toBe(false);
  });

  it('connect() calls requestAccess and then sets publicKey in state', async () => {
    const api = await getApi();
    vi.mocked(api.getAddress).mockResolvedValue({ address: 'GPUBLICKEY123' });

    const { result } = renderHook(() => useFreighter());
    await waitFor(() => expect(result.current.isInstalled).toBe(true));

    await act(async () => {
      await result.current.connect();
    });

    expect(api.requestAccess).toHaveBeenCalled();
    expect(result.current.publicKey).toBe('GPUBLICKEY123');
    expect(result.current.isConnected).toBe(true);
  });

  it('sets error when network is not PUBLIC', async () => {
    const api = await getApi();
    vi.mocked(api.isConnected).mockResolvedValue({ isConnected: true });
    vi.mocked(api.getNetwork).mockResolvedValue({
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    vi.mocked(api.getAddress).mockResolvedValue({ address: 'GPUBLICKEY' });

    const { result } = renderHook(() => useFreighter());
    await waitFor(() => expect(result.current.isConnected).toBe(true));
    expect(result.current.error).toBe('Please switch Freighter to Mainnet');
  });

  it('disconnect() resets state to the disconnected baseline', async () => {
    const api = await getApi();
    vi.mocked(api.isConnected).mockResolvedValue({ isConnected: true });
    vi.mocked(api.getAddress).mockResolvedValue({ address: 'GPUBLICKEY' });

    const { result } = renderHook(() => useFreighter());
    await waitFor(() => expect(result.current.isConnected).toBe(true));

    act(() => {
      result.current.disconnect();
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.publicKey).toBeNull();
    expect(result.current.network).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
