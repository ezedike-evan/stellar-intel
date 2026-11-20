import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import {
  MAINNET_ORACLE_CONTRACT_ID,
  TESTNET_ORACLE_CONTRACT_ID,
  currentNetwork,
  resolveOracleContractId,
} from '@/lib/oracle/deployment';
import { resolveReadDefaults } from '@/lib/oracle/read';

// `.deployments/mainnet.json` records the mainnet oracle, so the runbook step
// "record the contract id there" actually drives the tooling (#1405). An empty id
// means "not deployed yet", and must fail loudly rather than fall back to the
// testnet contract.

beforeEach(() => {
  vi.stubEnv('ORACLE_CONTRACT_ID', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('currentNetwork', () => {
  it('is testnet unless NEXT_PUBLIC_STELLAR_NETWORK is mainnet', () => {
    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'mainnet');
    expect(currentNetwork()).toBe('mainnet');
    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'testnet');
    expect(currentNetwork()).toBe('testnet');
    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'futurenet');
    expect(currentNetwork()).toBe('testnet');
    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', '');
    expect(currentNetwork()).toBe('testnet');
  });
});

describe('resolveOracleContractId (#1405)', () => {
  it('returns the recorded testnet id by default on testnet', () => {
    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'testnet');
    expect(resolveOracleContractId()).toBe(TESTNET_ORACLE_CONTRACT_ID);
    expect(TESTNET_ORACLE_CONTRACT_ID).toMatch(/^C[A-Z2-7]{55}$/);
  });

  it('lets ORACLE_CONTRACT_ID override both networks', () => {
    vi.stubEnv('ORACLE_CONTRACT_ID', 'CFROMENV');
    expect(resolveOracleContractId(undefined, 'testnet')).toBe('CFROMENV');
    expect(resolveOracleContractId(undefined, 'mainnet')).toBe('CFROMENV');
  });

  it('lets an explicit argument win over the env var and the record', () => {
    vi.stubEnv('ORACLE_CONTRACT_ID', 'CFROMENV');
    expect(resolveOracleContractId('CEXPLICIT', 'testnet')).toBe('CEXPLICIT');
    expect(resolveOracleContractId('CEXPLICIT', 'mainnet')).toBe('CEXPLICIT');
  });

  it('throws on mainnet while no mainnet deployment is recorded', () => {
    // The checked-in record is empty until the mainnet launch.
    expect(MAINNET_ORACLE_CONTRACT_ID).toBe('');
    expect(() => resolveOracleContractId(undefined, 'mainnet')).toThrow(
      'No mainnet oracle deployment recorded in .deployments/mainnet.json'
    );
  });

  it('follows NEXT_PUBLIC_STELLAR_NETWORK when no network is passed', () => {
    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'mainnet');
    expect(() => resolveOracleContractId()).toThrow(/No mainnet oracle deployment/);

    vi.stubEnv('ORACLE_CONTRACT_ID', 'CMAINNETFROMENV');
    expect(resolveOracleContractId()).toBe('CMAINNETFROMENV');
  });

  it('never silently returns the testnet contract for mainnet', () => {
    expect(() => resolveOracleContractId(undefined, 'mainnet')).toThrow();
  });
});

describe('resolveReadDefaults (#1405)', () => {
  it('uses the mainnet RPC and passphrase on mainnet', () => {
    expect(resolveReadDefaults('mainnet')).toEqual({
      rpcUrl: 'https://mainnet.sorobanrpc.com',
      networkPassphrase: Networks.PUBLIC,
    });
  });

  it('uses the testnet RPC and passphrase on testnet', () => {
    expect(resolveReadDefaults('testnet')).toEqual({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: Networks.TESTNET,
    });
  });

  it('picks mainnet when NEXT_PUBLIC_STELLAR_NETWORK=mainnet', () => {
    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'mainnet');
    expect(resolveReadDefaults().networkPassphrase).toBe(Networks.PUBLIC);

    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'testnet');
    expect(resolveReadDefaults().networkPassphrase).toBe(Networks.TESTNET);
  });
});
