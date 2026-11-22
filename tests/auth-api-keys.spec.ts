import { describe, expect, it } from 'vitest';
import {
  API_KEY_PATTERN,
  generateApiKey,
  hashApiKey,
  hashesEqual,
  hasScope,
  isApiScope,
  parseApiKey,
} from '@/lib/auth/api-keys';

const SECRET_43 = 'A'.repeat(43);

describe('generateApiKey', () => {
  it('returns a well-formed key, keyId and displayPrefix', async () => {
    const generated = await generateApiKey();
    const match = API_KEY_PATTERN.exec(generated.key);
    expect(match).not.toBeNull();
    expect(generated.keyId).toBe(match?.[1]);
    expect(generated.displayPrefix).toBe('sik_' + generated.keyId);
    expect(generated.hash).toBe(await hashApiKey(generated.key));
  });

  it('returns different keys on each call', async () => {
    const [a, b] = await Promise.all([generateApiKey(), generateApiKey()]);
    expect(a.key).not.toBe(b.key);
  });
});

describe('parseApiKey', () => {
  it('round-trips a generated key', async () => {
    const { key, keyId } = await generateApiKey();
    expect(parseApiKey(key)).toEqual({ keyId });
    expect(parseApiKey(`  ${key}  `)).toEqual({ keyId });
  });

  it.each([
    ['wrong prefix', `sk_0123456789abcdef_${SECRET_43}`],
    ['uppercase hex keyId', `sik_0123456789ABCDEF_${SECRET_43}`],
    ['42-character secret', `sik_0123456789abcdef_${'A'.repeat(42)}`],
    ['+ in the secret', `sik_0123456789abcdef_${'A'.repeat(42)}+`],
    ['/ in the secret', `sik_0123456789abcdef_${'A'.repeat(42)}/`],
    ['empty string', ''],
    ['whitespace only', '   '],
  ])('returns null for %s', (_label, raw) => {
    expect(parseApiKey(raw)).toBeNull();
  });
});

describe('hashApiKey', () => {
  it('is deterministic lowercase hex SHA-256 of the whole key', async () => {
    const { key } = await generateApiKey();
    const hash = await hashApiKey(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashApiKey(key)).toBe(hash);
    expect(await hashApiKey('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('differs for different keys', async () => {
    const [a, b] = await Promise.all([generateApiKey(), generateApiKey()]);
    expect(await hashApiKey(a.key)).not.toBe(await hashApiKey(b.key));
  });
});

describe('scopes', () => {
  it('hasScope matches exactly, and admin implies every scope', () => {
    expect(hasScope(['quotes:read'], 'quotes:read')).toBe(true);
    expect(hasScope(['quotes:read'], 'intents:write')).toBe(false);
    expect(hasScope(['admin'], 'intents:write')).toBe(true);
  });

  it('isApiScope rejects anything but the four scopes', () => {
    expect(isApiScope('quotes:read')).toBe(true);
    for (const value of ['quotes:write', '', 42, undefined]) {
      expect(isApiScope(value)).toBe(false);
    }
  });
});

describe('hashesEqual', () => {
  it('compares in constant time and tolerates length mismatch', () => {
    expect(hashesEqual('abc', 'abc')).toBe(true);
    expect(hashesEqual('abc', 'abd')).toBe(false);
    expect(() => hashesEqual('abc', 'abcd')).not.toThrow();
    expect(hashesEqual('abc', 'abcd')).toBe(false);
  });
});
