import { describe, it, expect } from 'vitest';
import {
  API_SCOPES,
  isApiScope,
  hasScope,
  API_KEY_PATTERN,
  generateApiKey,
  parseApiKey,
  hashApiKey,
  hashesEqual,
} from '@/lib/auth/api-keys';

describe('API Keys', () => {
  it('identifies valid scopes', () => {
    expect(isApiScope('quotes:read')).toBe(true);
    expect(isApiScope('quotes:write')).toBe(true);
    expect(isApiScope('metrics:read')).toBe(true);
    expect(isApiScope('admin')).toBe(true);
    expect(isApiScope('invalid:scope')).toBe(false);
  });

  it('checks scope hierarchy (admin grants all)', () => {
    expect(hasScope(['admin'], 'quotes:read')).toBe(true);
    expect(hasScope(['admin'], 'quotes:write')).toBe(true);
    expect(hasScope(['quotes:read'], 'quotes:read')).toBe(true);
    expect(hasScope(['quotes:read'], 'quotes:write')).toBe(false);
  });

  it('generates valid live and test keys', () => {
    const liveKey = generateApiKey('live');
    expect(liveKey.startsWith('si_live_')).toBe(true);
    expect(API_KEY_PATTERN.test(liveKey)).toBe(true);

    const testKey = generateApiKey('test');
    expect(testKey.startsWith('si_test_')).toBe(true);
    expect(API_KEY_PATTERN.test(testKey)).toBe(true);
  });

  it('parses valid api keys', () => {
    const key = generateApiKey('live');
    const parsed = parseApiKey(key);
    expect(parsed).not.toBeNull();
    expect(parsed?.env).toBe('live');
    expect(parsed?.id.length).toBeGreaterThan(0);

    expect(parseApiKey('invalid_key')).toBeNull();
  });

  it('hashes keys deterministically with SHA-256', async () => {
    const key = generateApiKey('live');
    const hash1 = await hashApiKey(key);
    const hash2 = await hashApiKey(key);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);

    const otherKey = key.slice(0, -1) + 'B';
    const hash3 = await hashApiKey(otherKey);
    expect(hash1).not.toBe(hash3);
  });

  it('compares hashes in constant time', () => {
    const h1 = 'abcdef123456';
    const h2 = 'abcdef123456';
    const h3 = 'abcdef123457';
    expect(hashesEqual(h1, h2)).toBe(true);
    expect(hashesEqual(h1, h3)).toBe(false);
    expect(hashesEqual(h1, 'short')).toBe(false);
  });
});
