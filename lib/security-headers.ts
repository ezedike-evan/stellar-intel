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

/**
 * Content-Security-Policy, shipped report-only. The browser talks to anchor
 * endpoints that come from the registry, so an enforcing policy needs a period
 * of observation first. `'unsafe-inline'` covers the inline theme script in
 * app/layout.tsx; plausible.io is the analytics script; `frame-src https:` is
 * the anchors' KYC iframe.
 */
export function buildCspReportOnly(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://plausible.io",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    'frame-src https:',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}
