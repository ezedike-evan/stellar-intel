export const API_SCOPES = ['quotes:read', 'quotes:write', 'metrics:read', 'admin'] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export const API_KEY_PATTERN = /^si_(live|test)_[A-Za-z0-9_-]{32,}$/;

export function isApiScope(val: unknown): val is ApiScope {
  return typeof val === 'string' && (API_SCOPES as readonly string[]).includes(val);
}

export function hasScope(granted: readonly ApiScope[], required: ApiScope): boolean {
  if (granted.includes('admin')) {
    return true;
  }
  return granted.includes(required);
}

export function generateApiKey(env: 'live' | 'test' = 'live'): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let base64 = '';
  if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(bytes).toString('base64url');
  } else {
    base64 = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
  return `si_${env}_${base64}`;
}

export function parseApiKey(key: string): { env: 'live' | 'test'; id: string } | null {
  if (!API_KEY_PATTERN.test(key)) {
    return null;
  }
  const parts = key.split('_');
  if (parts.length < 3) {
    return null;
  }
  const env = parts[1] as 'live' | 'test';
  const id = parts.slice(2).join('_');
  return { env, id };
}

export async function hashApiKey(key: string): Promise<string> {
  const enc = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
