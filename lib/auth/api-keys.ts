/**
 * lib/auth/api-keys.ts
 *
 * Caller API-key primitives (AGS001): the scope list, the key format, key
 * generation and hashing. No storage and no routes — those live in
 * lib/auth/key-store.ts and app/api/admin/keys.
 */

import { timingSafeEqual } from 'crypto';

/** Every scope a caller key can be granted. `admin` implies all of them. */
export const API_SCOPES = ['quotes:read', 'intents:write', 'reputation:write', 'admin'] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/** True only for one of the four exact scope strings. */
export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === 'string' && (API_SCOPES as readonly string[]).includes(value);
}

/** True when `granted` includes `required`, or includes `admin`. */
export function hasScope(granted: readonly ApiScope[], required: ApiScope): boolean {
  return granted.includes(required) || granted.includes('admin');
}

export const API_KEY_PREFIX = 'sik_';

/**
 * Caller key format: `sik_<keyId>_<secret>`.
 *
 * `keyId` is 16 lowercase hex characters (8 random bytes) and `secret` is 32
 * random bytes encoded as unpadded base64url (43 characters).
 */
export const API_KEY_PATTERN = /^sik_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/;

export interface GeneratedApiKey {
  key: string;
  keyId: string;
  /** `sik_${keyId}` — what listings and usage responses show instead of the key. */
  displayPrefix: string;
  hash: string;
}

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Unpadded base64url, as `API_KEY_PATTERN` requires. */
function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64URL_ALPHABET[b0 >> 2];
    out += BASE64URL_ALPHABET[((b0 & 0b11) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 !== undefined) out += BASE64URL_ALPHABET[((b1 & 0b1111) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 !== undefined) out += BASE64URL_ALPHABET[b2 & 0b111111];
  }
  return out;
}

/** Generates a caller key. The returned `key` is the only copy that will exist. */
export async function generateApiKey(): Promise<GeneratedApiKey> {
  const keyId = toHex(randomBytes(8));
  const secret = toBase64Url(randomBytes(32));
  const key = `${API_KEY_PREFIX}${keyId}_${secret}`;
  return {
    key,
    keyId,
    displayPrefix: `${API_KEY_PREFIX}${keyId}`,
    hash: await hashApiKey(key),
  };
}

/** Parses a caller key, returning its `keyId`, or null on any mismatch. */
export function parseApiKey(raw: string): { keyId: string } | null {
  const match = API_KEY_PATTERN.exec(raw.trim());
  const keyId = match?.[1];
  return keyId ? { keyId } : null;
}

/**
 * Lowercase hex SHA-256 of the whole key.
 *
 * Deliberately plain SHA-256 rather than a slow KDF: the secret is 256 bits of
 * randomness, so there is no dictionary to brute-force, and a slow hash would
 * add latency to every authenticated request.
 */
export async function hashApiKey(key: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return toHex(new Uint8Array(digest));
}

/** Constant-time comparison of two hashes; false (never throws) on length mismatch. */
export function hashesEqual(a: string, b: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}
