// Baseline security headers sent on every response (next.config.ts headers()).
//
// Kept here, not inline in next.config.ts, so a test can import the list without
// loading the config. HSTS is deliberately absent: Vercel already sends it.

export interface SecurityHeader {
  key: string;
  value: string;
}

export const SECURITY_HEADERS: readonly SecurityHeader[] = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // The execute UI must not be frameable, or it can be clickjacked.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];
