import { timingSafeEqual } from 'crypto';

// ─── Caller API-key primitives (AGS001) ────────────────────────────────────────
//
// Pure building blocks: scopes, the key format, generation and hashing. No I/O.

export const API_SCOPES = ['quotes:read', 'intents:write', 'reputation:write', 'admin'] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === 'string' && (API_SCOPES as readonly string[]).includes(value);
}

/** `admin` implies every scope. */
export function hasScope(granted: readonly ApiScope[], required: ApiScope): boolean {
  return granted.includes(required) || granted.includes('admin');
}

export const API_KEY_PREFIX = 'sik_';

export const API_KEY_PATTERN = /^sik_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/;

export interface GeneratedApiKey {
  key: string;
  keyId: string;
  displayPrefix: string;
  hash: string;
}

function randomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

export async function generateApiKey(): Promise<GeneratedApiKey> {
  const keyId = Buffer.from(randomBytes(8)).toString('hex');
  const secret = Buffer.from(randomBytes(32)).toString('base64url');
  const key = `${API_KEY_PREFIX}${keyId}_${secret}`;
  return { key, keyId, displayPrefix: `${API_KEY_PREFIX}${keyId}`, hash: await hashApiKey(key) };
}

export function parseApiKey(raw: string): { keyId: string } | null {
  const match = API_KEY_PATTERN.exec(raw.trim());
  return match ? { keyId: match[1] as string } : null;
}

/**
 * Lowercase hex SHA-256 of the whole key.
 *
 * Plain SHA-256 rather than a slow KDF (bcrypt, scrypt, argon2): the secret is
 * 256 bits of randomness, so there is no dictionary to brute-force, and a slow
 * hash would add latency to every authenticated request.
 */
export async function hashApiKey(key: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Buffer.from(digest).toString('hex');
}

export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
