// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import * as apiKeys from '@/lib/auth/api-keys';
import {
  API_KEY_PATTERN,
  API_KEY_PREFIX,
  API_SCOPES,
  generateApiKey,
  hasScope,
  hashApiKey,
  hashesEqual,
  isApiScope,
  parseApiKey,
} from '@/lib/auth/api-keys';

/** A well-formed key built by hand: a 16-hex key id and a 43-character secret. */
const KEY_ID = '0123456789abcdef';
const SECRET = 'A'.repeat(20) + 'b'.repeat(20) + '_-9';
const KEY = `sik_${KEY_ID}_${SECRET}`;

describe('API scopes', () => {
  it('lists exactly the four scopes', () => {
    expect(API_SCOPES).toEqual(['quotes:read', 'intents:write', 'reputation:write', 'admin']);
  });

  it('isApiScope is true only for those four strings', () => {
    for (const scope of API_SCOPES) expect(isApiScope(scope), scope).toBe(true);
    for (const other of ['quotes:write', '', 42, undefined, null, 'ADMIN', ' admin', ['admin']]) {
      expect(isApiScope(other), String(other)).toBe(false);
    }
  });

  it('hasScope: an exact match grants, a missing scope does not, and admin grants everything', () => {
    expect(hasScope(['quotes:read'], 'quotes:read')).toBe(true);
    expect(hasScope(['quotes:read', 'intents:write'], 'intents:write')).toBe(true);
    expect(hasScope(['quotes:read'], 'intents:write')).toBe(false);
    expect(hasScope([], 'quotes:read')).toBe(false);
    for (const required of API_SCOPES) {
      expect(hasScope(['admin'], required), required).toBe(true);
    }
    // Nothing but admin implies admin.
    expect(hasScope(['quotes:read', 'intents:write', 'reputation:write'], 'admin')).toBe(false);
  });
});

describe('generateApiKey', () => {
  it('returns a key in the documented format, with its id, display prefix and hash', async () => {
    const generated = await generateApiKey();
    const match = API_KEY_PATTERN.exec(generated.key);

    expect(match).not.toBeNull();
    expect(generated.keyId).toBe(match?.[1]);
    expect(generated.displayPrefix).toBe(`sik_${generated.keyId}`);
    expect(generated.key.startsWith(`${generated.displayPrefix}_`)).toBe(true);
    expect(generated.hash).toBe(await hashApiKey(generated.key));
    expect(Object.keys(generated).sort()).toEqual(['displayPrefix', 'hash', 'key', 'keyId']);
    // The display prefix is safe to show: the secret is not in it.
    expect(generated.displayPrefix).not.toContain(match?.[2]);
  });

  it('draws 8 bytes for the id and 32 for the secret', async () => {
    const { key, keyId } = await generateApiKey();
    const secret = API_KEY_PATTERN.exec(key)?.[2] ?? '';

    expect(Buffer.from(keyId, 'hex')).toHaveLength(8);
    expect(secret).toHaveLength(43);
    expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
    // Unpadded base64url: no '+', '/' or '='.
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('takes both parts from crypto.getRandomValues and encodes them as documented', async () => {
    const lengths: number[] = [];
    const spy = vi
      .spyOn(globalThis.crypto, 'getRandomValues')
      .mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
        const bytes = array as unknown as Uint8Array;
        lengths.push(bytes.length);
        // 0xfb bytes encode to '+' and '/' in plain base64, so the url-safe form is exercised.
        bytes.fill(lengths.length === 1 ? 0xab : 0xfb);
        return array;
      });
    try {
      const { key, keyId } = await generateApiKey();
      expect(lengths).toEqual([8, 32]);
      expect(keyId).toBe('ab'.repeat(8));
      expect(key).toBe(`sik_${keyId}_${Buffer.alloc(32, 0xfb).toString('base64url')}`);
      expect(key).toMatch(API_KEY_PATTERN);
    } finally {
      spy.mockRestore();
    }
  });

  it('never returns the same key, id or hash twice', async () => {
    const generated = await Promise.all(Array.from({ length: 50 }, () => generateApiKey()));
    for (const field of ['key', 'keyId', 'hash'] as const) {
      expect(new Set(generated.map((g) => g[field])).size, field).toBe(50);
    }
    for (const g of generated) expect(g.key, g.key).toMatch(API_KEY_PATTERN);
  });
});

describe('parseApiKey', () => {
  it('round-trips a generated key, ignoring surrounding whitespace', async () => {
    const { key, keyId } = await generateApiKey();
    expect(parseApiKey(key)).toEqual({ keyId });
    expect(parseApiKey(`  ${key}\n`)).toEqual({ keyId });
    expect(parseApiKey(KEY)).toEqual({ keyId: KEY_ID });
  });

  it('returns null for anything that is not a key', () => {
    const malformed = {
      'wrong prefix': `sk_${KEY_ID}_${SECRET}`,
      'upper-case hex id': `sik_${KEY_ID.toUpperCase()}_${SECRET}`,
      'a 15-character id': `sik_${KEY_ID.slice(1)}_${SECRET}`,
      'a non-hex id': `sik_${KEY_ID.slice(1)}g_${SECRET}`,
      'a 42-character secret': `sik_${KEY_ID}_${SECRET.slice(1)}`,
      'a 44-character secret': `sik_${KEY_ID}_${SECRET}A`,
      'a + in the secret': `sik_${KEY_ID}_${SECRET.slice(1)}+`,
      'a / in the secret': `sik_${KEY_ID}_${SECRET.slice(1)}/`,
      'padding in the secret': `sik_${KEY_ID}_${SECRET.slice(1)}=`,
      'a key inside other text': `Bearer ${KEY}`,
      'two keys': `${KEY} ${KEY}`,
      'whitespace inside': `sik_${KEY_ID} _${SECRET}`,
      'an empty string': '',
      'whitespace only': '   \n\t',
    };
    for (const [what, raw] of Object.entries(malformed)) {
      expect(parseApiKey(raw), what).toBeNull();
    }
  });
});

describe('hashApiKey', () => {
  it('is the lower-case hex SHA-256 of the whole key', async () => {
    const hash = await hashApiKey(KEY);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash('sha256').update(KEY).digest('hex'));
    // The whole key: the prefix and the id are hashed too, as UTF-8.
    expect(await hashApiKey('é')).toBe(createHash('sha256').update('é', 'utf8').digest('hex'));
  });

  it('is deterministic, and different for different keys', async () => {
    expect(await hashApiKey(KEY)).toBe(await hashApiKey(KEY));
    expect(await hashApiKey(KEY)).not.toBe(await hashApiKey(`${KEY.slice(0, -1)}A`));
    expect(await hashApiKey(KEY)).not.toBe(await hashApiKey(` ${KEY}`));
  });
});

describe('hashesEqual', () => {
  it('is true for equal hashes and false for unequal ones of the same length', async () => {
    const hash = await hashApiKey(KEY);
    expect(hashesEqual(hash, hash)).toBe(true);
    expect(hashesEqual(hash, await hashApiKey(KEY))).toBe(true);
    expect(hashesEqual(hash, await hashApiKey(`${KEY}x`))).toBe(false);
    expect(hashesEqual(hash, `${hash.slice(0, -1)}${hash.endsWith('0') ? '1' : '0'}`)).toBe(false);
  });

  it('is false, without throwing, when the lengths differ', async () => {
    const hash = await hashApiKey(KEY);
    expect(() => hashesEqual(hash, hash.slice(1))).not.toThrow();
    expect(hashesEqual(hash, hash.slice(1))).toBe(false);
    expect(hashesEqual(hash, '')).toBe(false);
    expect(hashesEqual('', hash)).toBe(false);
    expect(hashesEqual('', '')).toBe(true);
    // Same character count, different byte length.
    expect(hashesEqual('é', 'e')).toBe(false);
  });

  it('is enough, with hashApiKey, to check a presented key without keeping the raw one', async () => {
    const { key, hash: stored } = await generateApiKey();
    const other = await generateApiKey();
    expect(hashesEqual(await hashApiKey(key), stored)).toBe(true);
    expect(hashesEqual(await hashApiKey(other.key), stored)).toBe(false);
  });
});

describe('the module', () => {
  it('exports exactly the documented symbols', () => {
    expect(Object.keys(apiKeys).sort()).toEqual(
      [
        'API_KEY_PATTERN',
        'API_KEY_PREFIX',
        'API_SCOPES',
        'generateApiKey',
        'hasScope',
        'hashApiKey',
        'hashesEqual',
        'isApiScope',
        'parseApiKey',
      ].sort()
    );
    expect(API_KEY_PREFIX).toBe('sik_');
    expect(String(API_KEY_PATTERN)).toBe('/^sik_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/');
  });
});
