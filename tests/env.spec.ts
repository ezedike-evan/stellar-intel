import { describe, it, expect } from 'vitest';
import { envSchema, env } from '@/lib/env';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID: Record<string, string> = {
  NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
  NEXT_PUBLIC_HORIZON_URL: 'https://horizon.stellar.org',
  NEXT_PUBLIC_USDC_ISSUER: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  NEXT_PUBLIC_APP_NAME: 'Stellar Intel',
};

function without(key: string): Record<string, string> {
  const { [key]: _omitted, ...rest } = VALID;
  return rest;
}

function with_(key: string, value: string): Record<string, string> {
  return { ...VALID, [key]: value };
}

// ─── Schema acceptance ────────────────────────────────────────────────────────

describe('envSchema — valid inputs', () => {
  it('accepts a fully valid env object', () => {
    expect(envSchema.safeParse(VALID).success).toBe(true);
  });

  it('accepts testnet as NEXT_PUBLIC_STELLAR_NETWORK', () => {
    expect(envSchema.safeParse(with_('NEXT_PUBLIC_STELLAR_NETWORK', 'testnet')).success).toBe(true);
  });

  it('accepts futurenet as NEXT_PUBLIC_STELLAR_NETWORK', () => {
    expect(envSchema.safeParse(with_('NEXT_PUBLIC_STELLAR_NETWORK', 'futurenet')).success).toBe(
      true
    );
  });

  it('defaults NEXT_PUBLIC_STELLAR_EXPERT_URL when omitted', () => {
    const result = envSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NEXT_PUBLIC_STELLAR_EXPERT_URL).toBe(
        'https://api.stellar.expert/explorer/public'
      );
    }
  });

  it('accepts a custom NEXT_PUBLIC_STELLAR_EXPERT_URL', () => {
    const result = envSchema.safeParse(
      with_('NEXT_PUBLIC_STELLAR_EXPERT_URL', 'https://my-expert.example.com')
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NEXT_PUBLIC_STELLAR_EXPERT_URL).toBe('https://my-expert.example.com');
    }
  });
});

// ─── Schema rejection — each key is tested independently ─────────────────────

describe('envSchema — invalid NEXT_PUBLIC_STELLAR_NETWORK', () => {
  it('rejects an unknown network name', () => {
    const result = envSchema.safeParse(with_('NEXT_PUBLIC_STELLAR_NETWORK', 'invalid'));
    expect(result.success).toBe(false);
  });

  it('error path names the offending key', () => {
    const result = envSchema.safeParse(with_('NEXT_PUBLIC_STELLAR_NETWORK', 'devnet'));
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('NEXT_PUBLIC_STELLAR_NETWORK');
    }
  });
});

describe('envSchema — invalid NEXT_PUBLIC_HORIZON_URL', () => {
  it('rejects a non-URL string', () => {
    expect(envSchema.safeParse(with_('NEXT_PUBLIC_HORIZON_URL', 'not-a-url')).success).toBe(false);
  });

  it('rejects a missing key', () => {
    const result = envSchema.safeParse(without('NEXT_PUBLIC_HORIZON_URL'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('NEXT_PUBLIC_HORIZON_URL');
    }
  });

  it('error message includes the key name', () => {
    const result = envSchema.safeParse(without('NEXT_PUBLIC_HORIZON_URL'));
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'NEXT_PUBLIC_HORIZON_URL');
      expect(issue).toBeDefined();
    }
  });
});

describe('envSchema — invalid NEXT_PUBLIC_USDC_ISSUER', () => {
  it('rejects a non-Stellar key', () => {
    expect(envSchema.safeParse(with_('NEXT_PUBLIC_USDC_ISSUER', 'NOTAKEY')).success).toBe(false);
  });

  it('rejects a key that starts with a lowercase letter', () => {
    expect(
      envSchema.safeParse(
        with_('NEXT_PUBLIC_USDC_ISSUER', 'ga5zsejyb37jrc5avcia5mop4rhtm335x2kgx3ihojapp5re34k4kzvn')
      ).success
    ).toBe(false);
  });

  it('rejects a missing key', () => {
    const result = envSchema.safeParse(without('NEXT_PUBLIC_USDC_ISSUER'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('NEXT_PUBLIC_USDC_ISSUER');
    }
  });
});

describe('envSchema — invalid NEXT_PUBLIC_APP_NAME', () => {
  it('rejects an empty string', () => {
    expect(envSchema.safeParse(with_('NEXT_PUBLIC_APP_NAME', '')).success).toBe(false);
  });

  it('rejects a missing key', () => {
    const result = envSchema.safeParse(without('NEXT_PUBLIC_APP_NAME'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('NEXT_PUBLIC_APP_NAME');
    }
  });
});

// ─── Live env (populated by vitest.config.ts) ─────────────────────────────────

describe('env — parsed from the vitest test environment', () => {
  it('is defined and not null', () => {
    expect(env).toBeDefined();
  });

  it('stellarNetwork is mainnet in the test env', () => {
    expect(env.NEXT_PUBLIC_STELLAR_NETWORK).toBe('mainnet');
  });

  it('horizonUrl matches the vitest env', () => {
    expect(env.NEXT_PUBLIC_HORIZON_URL).toBe('https://horizon.stellar.org');
  });

  it('usdcIssuer is a valid Stellar public key', () => {
    expect(/^G[A-Z0-9]{55}$/.test(env.NEXT_PUBLIC_USDC_ISSUER)).toBe(true);
  });

  it('appName is non-empty', () => {
    expect(env.NEXT_PUBLIC_APP_NAME.length).toBeGreaterThan(0);
  });
});
