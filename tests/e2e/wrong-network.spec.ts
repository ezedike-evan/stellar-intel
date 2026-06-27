import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { useFreighter } from '@/hooks/useFreighter';

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  requestAccess: vi.fn(),
  WatchWalletChanges: class {
    watch = vi.fn();
    stop = vi.fn();
  },
}));

import { WalletProvider } from '@/contexts/WalletContext';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(WalletProvider, null, children);

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

describe('wrong-network state — Freighter on testnet, app on mainnet', () => {
  it('hook reports network error when Freighter is on TESTNET', async () => {
    const api = await getApi();
    vi.mocked(api.isConnected).mockResolvedValue({ isConnected: true });
    vi.mocked(api.getNetwork).mockResolvedValue({
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    vi.mocked(api.getAddress).mockResolvedValue({ address: 'GPUBLICKEY' });

    const { result } = renderHook(() => useFreighter(), { wrapper });

    await waitFor(() => expect(result.current.isConnected).toBe(true));
    expect(result.current.network).toBe('TESTNET');
    expect(result.current.error).toBe('Please switch Freighter to Mainnet');
  });

  it('hook reports no error when Freighter is on mainnet (PUBLIC)', async () => {
    const api = await getApi();
    vi.mocked(api.isConnected).mockResolvedValue({ isConnected: true });
    vi.mocked(api.getNetwork).mockResolvedValue({
      network: 'PUBLIC',
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
    });
    vi.mocked(api.getAddress).mockResolvedValue({ address: 'GPUBLICKEY' });

    const { result } = renderHook(() => useFreighter(), { wrapper });

    await waitFor(() => expect(result.current.isConnected).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it('guidance message is the expected string when on wrong network', async () => {
    const api = await getApi();
    vi.mocked(api.isConnected).mockResolvedValue({ isConnected: true });
    vi.mocked(api.getNetwork).mockResolvedValue({
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    vi.mocked(api.getAddress).mockResolvedValue({ address: 'GPUBLICKEY' });

    const { result } = renderHook(() => useFreighter(), { wrapper });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe('Please switch Freighter to Mainnet');
  });

  it('execute is disabled (canExecute is false) when the wallet has a network error', async () => {
    const api = await getApi();
    vi.mocked(api.isConnected).mockResolvedValue({ isConnected: true });
    vi.mocked(api.getNetwork).mockResolvedValue({
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    vi.mocked(api.getAddress).mockResolvedValue({ address: 'GPUBLICKEY' });

    const { result } = renderHook(() => useFreighter(), { wrapper });

    await waitFor(() => expect(result.current.isConnected).toBe(true));

    // A network error means the execute action must not be allowed.
    const canExecute = result.current.isConnected && result.current.error === null;
    expect(canExecute).toBe(false);
  });

  it('execute becomes available after switching to mainnet', async () => {
    const api = await getApi();

    vi.mocked(api.isConnected).mockResolvedValue({ isConnected: true });
    vi.mocked(api.getNetwork).mockResolvedValue({
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    vi.mocked(api.getAddress).mockResolvedValue({ address: 'GPUBLICKEY' });

    const { result } = renderHook(() => useFreighter(), { wrapper });

    await waitFor(() => expect(result.current.error).toBe('Please switch Freighter to Mainnet'));

    // Simulate user switching to mainnet
    vi.mocked(api.getNetwork).mockResolvedValue({
      network: 'PUBLIC',
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
    });

    await waitFor(() => expect(result.current.error).toBeNull(), { timeout: 2000 });
    expect(result.current.isConnected).toBe(true);
  });
});
