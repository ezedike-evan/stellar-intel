import { beforeAll, describe, expect, it } from 'vitest';
import type { NextConfig } from 'next';

describe('next.config.ts images (#1361)', () => {
  let config: NextConfig;

  beforeAll(async () => {
    // lib/env validates these when the config is imported.
    process.env.NEXT_PUBLIC_STELLAR_NETWORK ??= 'mainnet';
    process.env.NEXT_PUBLIC_HORIZON_URL ??= 'https://horizon.stellar.org';
    process.env.NEXT_PUBLIC_USDC_ISSUER ??=
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
    process.env.NEXT_PUBLIC_APP_NAME ??= 'Stellar Intel';
    config = (await import('../next.config')).default;
  });

  it('does not let /_next/image proxy an arbitrary https host', () => {
    const patterns = config.images?.remotePatterns ?? [];
    expect(patterns.some((p) => 'hostname' in p && p.hostname === '**')).toBe(false);
  });

  it('allows no remote host at all, since the app only loads local images', () => {
    expect(config.images?.remotePatterns).toEqual([]);
  });

  it('keeps the image formats and cache TTL', () => {
    expect(config.images?.formats).toEqual(['image/avif', 'image/webp']);
    expect(config.images?.minimumCacheTTL).toBe(86400);
  });

  it('serves the security headers on every path', async () => {
    const rules = (await config.headers?.()) ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe('/:path*');
    const keys = rules[0]?.headers.map((h) => h.key) ?? [];
    expect(keys).toEqual(
      expect.arrayContaining(['X-Frame-Options', 'Content-Security-Policy-Report-Only'])
    );
  });
});
