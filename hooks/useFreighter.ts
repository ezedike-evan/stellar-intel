import { useState, useEffect, useCallback, useRef } from 'react';
import type { FreighterState } from '@/types';

// Freighter API is a browser extension — import lazily to avoid SSR errors
async function getFreighterApi() {
  const mod = await import('@stellar/freighter-api');
  return mod;
}

const INITIAL_STATE: FreighterState = {
  isInstalled: false,
  isConnected: false,
  publicKey: null,
  network: null,
  error: null,
};

/**
 * Manages Freighter wallet connection state (freighter-api v6).
 * All API calls return result objects { field, error? } — errors are explicit, not thrown.
 * Validates the user is on Stellar mainnet (PUBLIC network).
 */
export function useFreighter() {
  const [state, setState] = useState<FreighterState>(INITIAL_STATE);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Check extension presence on mount
  useEffect(() => {
    let cancelled = false;

    async function checkInstalled() {
      try {
        const { isConnected, getAddress, getNetwork } = await getFreighterApi();
        const connResult = await isConnected();

        if (cancelled) return;

        if (connResult.error || !connResult.isConnected) {
          setState((s) => ({ ...s, isInstalled: true, isConnected: false }));
          return;
        }

        const [addrResult, netResult] = await Promise.all([getAddress(), getNetwork()]);
        if (cancelled) return;

        const networkName = netResult.network ?? null;
        const networkError = networkName !== 'PUBLIC' ? 'Please switch Freighter to Mainnet' : null;

        setState({
          isInstalled: true,
          isConnected: true,
          publicKey: addrResult.address ?? null,
          network: networkName,
          error: networkError,
        });
      } catch {
        if (cancelled) return;
        setState({ ...INITIAL_STATE, isInstalled: false });
      }
    }

    checkInstalled();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setState((s) => ({ ...s, error: null }));
    try {
      const { requestAccess, getAddress, getNetwork } = await getFreighterApi();
      const accessResult = await requestAccess();
      if (accessResult.error) throw new Error(String(accessResult.error));

      const [addrResult, netResult] = await Promise.all([getAddress(), getNetwork()]);
      if (!mountedRef.current) return;

      const networkName = netResult.network ?? null;
      const networkError = networkName !== 'PUBLIC' ? 'Please switch Freighter to Mainnet' : null;

      setState({
        isInstalled: true,
        isConnected: true,
        publicKey: addrResult.address ?? null,
        network: networkName,
        error: networkError,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setState((s) => ({
        ...s,
        isConnected: false,
        publicKey: null,
        error: err instanceof Error ? err.message : 'Connection failed',
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    setState({
      isInstalled: true,
      isConnected: false,
      publicKey: null,
      network: null,
      error: null,
    });
  }, []);

  return { ...state, connect, disconnect };
}
