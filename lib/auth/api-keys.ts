import { timingSafeEqual } from 'crypto';

/**
 * Caller API keys: the pure building blocks. A caller is an agent or an
 * integrator with an identity of its own, so that it can have its own rate-limit
 * budget, narrow scopes and an audit trail.
 *
 * Nothing here stores a key, reads the environment or touches the network.
 */

/** What a key may be allowed to do. `admin` implies every other scope. */
export const API_SCOPES = ['quotes:read', 'intents:write', 'reputation:write', 'admin'] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/** True only for the four exact scope strings. */
export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === 'string' && (API_SCOPES as readonly string[]).includes(value);
}

/** Whether `granted` covers `required`: it lists it, or it lists `admin`. */
export function hasScope(granted: readonly ApiScope[], required: ApiScope): boolean {
  return granted.includes(required) || granted.includes('admin');
}

export const API_KEY_PREFIX = 'sik_';

/**
 * `sik_<keyId>_<secret>`. `keyId` is 16 lower-case hex characters (8 random
 * bytes) and is not secret: it is how a key is looked up and shown. `secret` is 32
 * random bytes as unpadded base64url, which is 43 characters.
 */
export const API_KEY_PATTERN = /^sik_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/;

export interface GeneratedApiKey {
  /** The whole key. Shown to its owner once and never stored. */
  key: string;
  keyId: string;
  /** `sik_<keyId>`: what admin listings and usage responses show instead of the key. */
  displayPrefix: string;
  /** `hashApiKey(key)`: what is stored and compared. */
  hash: string;
}

const KEY_ID_BYTES = 8;
const SECRET_BYTES = 32;

function randomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** A new key, with the hash to store for it. Both parts come from the platform's CSPRNG. */
export async function generateApiKey(): Promise<GeneratedApiKey> {
  const keyId = toHex(randomBytes(KEY_ID_BYTES));
  const key = `${API_KEY_PREFIX}${keyId}_${toBase64Url(randomBytes(SECRET_BYTES))}`;
  return { key, keyId, displayPrefix: `${API_KEY_PREFIX}${keyId}`, hash: await hashApiKey(key) };
}

/** The `keyId` of a well-formed key, or null. Surrounding whitespace is ignored. */
export function parseApiKey(raw: string): { keyId: string } | null {
  const keyId = API_KEY_PATTERN.exec(raw.trim())?.[1];
  return keyId === undefined ? null : { keyId };
}

/**
 * The lower-case hex SHA-256 of the whole key's UTF-8 bytes.
 *
 * Plain SHA-256, not a slow KDF such as scrypt or argon2, and on purpose. A slow
 * hash exists to make guessing a human-chosen password expensive. A key's secret is
 * 256 bits from a CSPRNG: there is no dictionary to try, and brute force is out of
 * reach at any speed. A slow hash would only add its cost to every authenticated
 * request.
 */
export async function hashApiKey(key: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return toHex(new Uint8Array(digest));
}

/**
 * Compares two hashes in constant time, as `lib/auth/admin.ts` compares the admin
 * key. A length mismatch is `false`, not a throw: `timingSafeEqual` throws on one.
 */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
