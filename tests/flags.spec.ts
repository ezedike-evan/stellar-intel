import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Feature flags (lib/flags.ts)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refundGuarantees is false when NEXT_PUBLIC_REFUND_GUARANTEES is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_REFUND_GUARANTEES', '');
    const { flags } = await import('@/lib/flags');
    expect(flags.refundGuarantees).toBe(false);
  });

  it('refundGuarantees is true when NEXT_PUBLIC_REFUND_GUARANTEES is "on"', async () => {
    vi.stubEnv('NEXT_PUBLIC_REFUND_GUARANTEES', 'on');
    const { flags } = await import('@/lib/flags');
    expect(flags.refundGuarantees).toBe(true);
  });
});
