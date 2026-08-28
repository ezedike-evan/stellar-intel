import { describe, it, expect } from 'vitest';
import { resolveNetwork, isStellarNetwork } from '../src/network';

// Regression tests for #912. The CLI used to default to mainnet whenever
// STELLAR_NETWORK_PASSPHRASE was unset, while /api/publisher/tick defaulted to
// testnet — so the same pipeline signed against different networks depending on
// how it was invoked.

describe('resolveNetwork (#912)', () => {
  it('refuses to guess when STELLAR_NETWORK is unset', () => {
    expect(() => resolveNetwork({})).toThrow(/STELLAR_NETWORK is required/);
  });

  it('rejects a network it does not know', () => {
    expect(() => resolveNetwork({ STELLAR_NETWORK: 'futurenet' })).toThrow(
      /must be "mainnet" or "testnet"/
    );
  });

  it('resolves testnet to testnet endpoints', () => {
    const cfg = resolveNetwork({ STELLAR_NETWORK: 'testnet' });
    expect(cfg.network).toBe('testnet');
    expect(cfg.networkPassphrase).toBe('Test SDF Network ; September 2015');
    expect(cfg.rpcUrl).toBe('https://soroban-testnet.stellar.org');
    expect(cfg.horizonUrl).toBe('https://horizon-testnet.stellar.org');
  });

  it('resolves mainnet only when asked explicitly', () => {
    const cfg = resolveNetwork({ STELLAR_NETWORK: 'mainnet' });
    expect(cfg.networkPassphrase).toBe('Public Global Stellar Network ; September 2015');
    expect(cfg.rpcUrl).toBe('https://mainnet.sorobanrpc.com');
  });

  it('allows endpoint overrides', () => {
    const cfg = resolveNetwork({
      STELLAR_NETWORK: 'testnet',
      SOROBAN_RPC_URL: 'http://localhost:8000/soroban/rpc',
      HORIZON_URL: 'http://localhost:8000',
    });
    expect(cfg.rpcUrl).toBe('http://localhost:8000/soroban/rpc');
    expect(cfg.horizonUrl).toBe('http://localhost:8000');
  });

  it('keeps the passphrase tied to the named network', () => {
    // The dangerous combination: a testnet passphrase would let a mainnet RPC
    // look harmless. The passphrase is not independently overridable.
    const cfg = resolveNetwork({
      STELLAR_NETWORK: 'testnet',
      SOROBAN_RPC_URL: 'https://mainnet.sorobanrpc.com',
      STELLAR_NETWORK_PASSPHRASE: 'Public Global Stellar Network ; September 2015',
    });
    expect(cfg.networkPassphrase).toBe('Test SDF Network ; September 2015');
  });

  it('isStellarNetwork narrows correctly', () => {
    expect(isStellarNetwork('mainnet')).toBe(true);
    expect(isStellarNetwork('testnet')).toBe(true);
    expect(isStellarNetwork('futurenet')).toBe(false);
  });
});
