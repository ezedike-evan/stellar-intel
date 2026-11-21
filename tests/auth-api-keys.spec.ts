import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  API_KEY_PATTERN,
  generateApiKey,
  hasScope,
  hashApiKey,
  hashesEqual,
  isApiScope,
  parseApiKey,
} from '@/lib/auth/api-keys';

describe('lib/auth/api-keys.ts (AGS001)', () => {
  it('generateApiKey returns valid keys matching pattern, with displayPrefix and distinct values', async () => {
    const k1 = await generateApiKey();
    const k2 = await generateApiKey();

    expect(k1.key).toMatch(API_KEY_PATTERN);
    const match = API_KEY_PATTERN.exec(k1.key);
    expect(match).not.toBeNull();
    expect(k1.keyId).toBe(match![1]);
    expect(k1.displayPrefix).toBe(`sik_${k1.keyId}`);
    expect(k1.key).not.toBe(k2.key);
    expect(k1.keyId).not.toBe(k2.keyId);
  });

  it('parseApiKey round-trips a generated key and rejects invalid inputs', async () => {
    const generated = await generateApiKey();
    expect(parseApiKey(generated.key)).toEqual({ keyId: generated.keyId });
    expect(parseApiKey(`  ${generated.key}  `)).toEqual({ keyId: generated.keyId });

    expect(parseApiKey(`sk_${generated.keyId}_${'a'.repeat(43)}`)).toBeNull();
    expect(parseApiKey(`sik_${generated.keyId.toUpperCase()}_${'a'.repeat(43)}`)).toBeNull();
    expect(parseApiKey(`sik_${generated.keyId}_${'a'.repeat(42)}`)).toBeNull();
    expect(parseApiKey(`sik_${generated.keyId}_${'a'.repeat(41)}+/`)).toBeNull();
    expect(parseApiKey('')).toBeNull();
    expect(parseApiKey('   \t\n  ')).toBeNull();
  });

  it('hashApiKey is deterministic, 64-char lowercase hex, equal to node:crypto sha256', async () => {
    const generated = await generateApiKey();
    const hash = await hashApiKey(generated.key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(await hashApiKey(generated.key));

    const expected = createHash('sha256').update(generated.key).digest('hex');
    expect(hash).toBe(expected);

    const other = await generateApiKey();
    expect(await hashApiKey(other.key)).not.toBe(hash);
  });

  it('hasScope handles exact matches and admin scope', () => {
    expect(hasScope(['quotes:read'], 'quotes:read')).toBe(true);
    expect(hasScope(['quotes:read'], 'intents:write')).toBe(false);
    expect(hasScope(['admin'], 'intents:write')).toBe(true);
    expect(hasScope(['admin'], 'reputation:write')).toBe(true);
    expect(hasScope(['admin'], 'quotes:read')).toBe(true);
  });

  it('isApiScope validates against allowed scopes', () => {
    expect(isApiScope('quotes:read')).toBe(true);
    expect(isApiScope('intents:write')).toBe(true);
    expect(isApiScope('reputation:write')).toBe(true);
    expect(isApiScope('admin')).toBe(true);

    expect(isApiScope('quotes:write')).toBe(false);
    expect(isApiScope('')).toBe(false);
    expect(isApiScope(42)).toBe(false);
    expect(isApiScope(undefined)).toBe(false);
  });

  it('hashesEqual compares in constant time and handles length mismatch', () => {
    const h1 = 'a'.repeat(64);
    const h2 = 'a'.repeat(64);
    const h3 = 'b'.repeat(64);
    const hShort = 'a'.repeat(32);

    expect(hashesEqual(h1, h2)).toBe(true);
    expect(hashesEqual(h1, h3)).toBe(false);
    expect(hashesEqual(h1, hShort)).toBe(false);
  });
});
