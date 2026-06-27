import { describe, expect, it } from 'vitest';
import { hasSep6, getSep6TransferServer } from '@/lib/stellar/sep6';
import { Sep6NotSupportedError } from '@/lib/stellar/errors';

describe('hasSep6', () => {
  it('returns true for a toml that advertises TRANSFER_SERVER', () => {
    expect(hasSep6({ TRANSFER_SERVER: 'https://anchor.example.com/sep6' })).toBe(true);
  });

  it('returns false when TRANSFER_SERVER is absent', () => {
    expect(hasSep6({})).toBe(false);
  });

  it('returns false for a blank or whitespace-only TRANSFER_SERVER', () => {
    expect(hasSep6({ TRANSFER_SERVER: '   ' })).toBe(false);
    expect(hasSep6({ TRANSFER_SERVER: null })).toBe(false);
  });
});

describe('getSep6TransferServer', () => {
  it('returns the trimmed transfer server URL when present', () => {
    expect(getSep6TransferServer({ TRANSFER_SERVER: '  https://anchor.example.com/sep6  ' })).toBe(
      'https://anchor.example.com/sep6'
    );
  });

  it('throws a typed Sep6NotSupportedError when absent', () => {
    expect(() => getSep6TransferServer({ domain: 'anchor.example.com' })).toThrow(
      Sep6NotSupportedError
    );
  });
});
