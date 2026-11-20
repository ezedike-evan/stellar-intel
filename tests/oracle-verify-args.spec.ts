import { describe, expect, it } from 'vitest';
import { parseVerifyArgs } from '@/scripts/lib/oracle-verify';

// verify-oracle-read.mts used to check testnet whatever the runbook told the
// operator to set, so a "mainnet verification" checked testnet (#1406). The
// network it targets is now explicit and parsed here, without running the script.

describe('parseVerifyArgs (#1406)', () => {
  it('defaults to testnet, warn-only, on usdc-ngn', () => {
    expect(parseVerifyArgs([], {})).toEqual({
      strict: false,
      network: 'testnet',
      corridor: 'usdc-ngn',
    });
  });

  it('lets --network mainnet win over the environment', () => {
    const args = parseVerifyArgs(['--network', 'mainnet'], {
      NEXT_PUBLIC_STELLAR_NETWORK: 'testnet',
    });
    expect(args.network).toBe('mainnet');
  });

  it('lets --network testnet win over a mainnet environment', () => {
    const args = parseVerifyArgs(['--network', 'testnet'], {
      NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
    });
    expect(args.network).toBe('testnet');
  });

  it('honours NEXT_PUBLIC_STELLAR_NETWORK=mainnet when no flag is given', () => {
    expect(parseVerifyArgs([], { NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet' }).network).toBe('mainnet');
  });

  it('treats an empty NEXT_PUBLIC_STELLAR_NETWORK as unset', () => {
    expect(parseVerifyArgs([], { NEXT_PUBLIC_STELLAR_NETWORK: '' }).network).toBe('testnet');
  });

  it('throws on an invalid --network', () => {
    expect(() => parseVerifyArgs(['--network', 'futurenet'], {})).toThrow(/Invalid --network/);
    expect(() => parseVerifyArgs(['--network', 'main'], {})).toThrow(/mainnet/);
  });

  it('throws on an invalid environment network rather than guessing', () => {
    expect(() => parseVerifyArgs([], { NEXT_PUBLIC_STELLAR_NETWORK: 'futurenet' })).toThrow(
      /Invalid NEXT_PUBLIC_STELLAR_NETWORK/
    );
  });

  it('throws when --network has no value', () => {
    expect(() => parseVerifyArgs(['--network'], {})).toThrow(/requires a value/);
    expect(() => parseVerifyArgs(['--network', '--strict'], {})).toThrow(/requires a value/);
  });

  it('still parses --corridor', () => {
    expect(parseVerifyArgs(['--corridor', 'usdc-kes'], {}).corridor).toBe('usdc-kes');
  });

  it('still parses --strict, alongside the other flags in any order', () => {
    const args = parseVerifyArgs(
      ['--corridor', 'usdc-kes', '--strict', '--network', 'mainnet'],
      {}
    );
    expect(args).toEqual({ strict: true, network: 'mainnet', corridor: 'usdc-kes' });
  });
});
