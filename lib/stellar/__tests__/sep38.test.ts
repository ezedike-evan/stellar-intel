import { describe, it, expect } from 'vitest';
import { assertSep38Capable } from '../sep38';
import type { Sep1TomlData } from '@/types';

function makeToml(overrides: Partial<Sep1TomlData> = {}): Sep1TomlData {
  return {
    domain: 'test.anchor.com',
    TRANSFER_SERVER_SEP0024: null,
    ANCHOR_QUOTE_SERVER: null,
    WEB_AUTH_ENDPOINT: null,
    SIGNING_KEY: null,
    NETWORK_PASSPHRASE: null,
    ORG_URL: null,
    ORG_SUPPORT_EMAIL: null,
    ORG_SUPPORT_URL: null,
    CURRENCIES: [],
    capabilities: { sep10: false, sep24: false, sep38: false, sep12: false },
    ...overrides,
  };
}

describe('assertSep38Capable', () => {
  it('throws when capabilities.sep38 is false', () => {
    const toml = makeToml();
    expect(() => assertSep38Capable(toml)).toThrow(
      'Anchor "test.anchor.com" does not advertise ANCHOR_QUOTE_SERVER and cannot be used for SEP-38.'
    );
  });

  it('throws when ANCHOR_QUOTE_SERVER is null even if flag is true', () => {
    const toml = makeToml({
      capabilities: { sep10: false, sep24: false, sep38: true, sep12: false },
    });
    expect(() => assertSep38Capable(toml)).toThrow('cannot be used for SEP-38');
  });

  it('returns the quote server URL when the anchor is SEP-38 capable', () => {
    const url = 'https://anchor.example.com/quote';
    const toml = makeToml({
      ANCHOR_QUOTE_SERVER: url,
      capabilities: { sep10: false, sep24: false, sep38: true, sep12: false },
    });
    expect(assertSep38Capable(toml)).toBe(url);
  });
});
