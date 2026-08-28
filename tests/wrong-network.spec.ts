import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { useFreighter } from '@/hooks/useFreighter';

type WalletChange = { address?: string; network?: string };

// useFreighter picks up live network/account changes via WatchWalletChanges'
// callback (see hooks/useFreighter.ts), not by re-polling getNetwork() -- a
// mock that never invokes that callback (e.g. plain `watch = vi.fn()`) can
// never observe a network switch after mount. `watchers` captures each
// instance so a test can fire its callback directly, exactly like Freighter
// would.
const { watchers } = vi.hoisted(() => ({
  watchers: [] as Array<{ fire: (change: WalletChange) => void }>,
}));

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  requestAccess: vi.fn(),
  WatchWalletChanges: vi.fn().mockImplementation(function WatchWalletChanges() {
    let callback: ((change: WalletChange) => void) | null = null;
    const instance = {
      watch: (cb: (change: WalletChange) => void) => {
        callback = cb;
      },
      stop: vi.fn(),
      fire: (change: WalletChange) => callback?.(change),
    };
    watchers.push(instance);
    return instance;
  }),
}));

import { WalletProvider } from '@/contexts/WalletContext';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(WalletProvider, null, children);

async function getApi() {
  return await import('@stellar/freighter-api');
}

beforeEach(async () => {
  vi.clearAllMocks();
  watchers.length = 0;
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

    // Simulate user switching to mainnet, then Freighter's watcher notifying
    // the app -- the same path a real network switch takes (see
    // hooks/useFreighter.ts's WatchWalletChanges callback).
    vi.mocked(api.getNetwork).mockResolvedValue({
      network: 'PUBLIC',
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
    });
    act(() => {
      watchers[0]?.fire({ address: 'GPUBLICKEY', network: 'PUBLIC' });
    });

    await waitFor(() => expect(result.current.error).toBeNull(), { timeout: 2000 });
    expect(result.current.isConnected).toBe(true);
  });
});
