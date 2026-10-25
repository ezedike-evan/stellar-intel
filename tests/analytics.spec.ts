import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FUNNEL_EVENTS,
  ONRAMP_FUNNEL_EVENTS,
  type FunnelEventName,
  amountBucket,
  redactProperties,
  trackAnalyticsEvent,
  trackFunnelEvent,
} from '@/lib/analytics';

type PlausibleCall = [string, { props?: Record<string, string | number | boolean> } | undefined];

describe('amountBucket', () => {
  it('maps amounts into coarse buckets', () => {
    expect(amountBucket(0)).toBe('0-10');
    expect(amountBucket('9.99')).toBe('0-10');
    expect(amountBucket(10)).toBe('10-50');
    expect(amountBucket(49)).toBe('10-50');
    expect(amountBucket(100)).toBe('100-500');
    expect(amountBucket(999)).toBe('500-1000');
    expect(amountBucket(1000)).toBe('1000+');
  });

  it('returns unknown for invalid amounts', () => {
    expect(amountBucket('nope')).toBe('unknown');
    expect(amountBucket(Number.NaN)).toBe('unknown');
    expect(amountBucket(-1)).toBe('unknown');
    expect(amountBucket(undefined)).toBe('unknown');
  });
});

describe('redactProperties', () => {
  it('redacts registered PII keys', () => {
    const out = redactProperties({
      corridor: 'usdc-ngn',
      account: 'secret',
      email: 'user@example.com',
    });
    expect(out.corridor).toBe('usdc-ngn');
    expect(out.account).toBe('[REDACTED]');
    expect(out.email).toBe('[REDACTED]');
  });

  it('redacts Stellar wallet addresses in values', () => {
    const wallet = 'G' + 'A'.repeat(55);
    const out = redactProperties({ publicKey: wallet, corridor: 'usdc-kes' });
    expect(out.publicKey).toBe('[REDACTED_WALLET]');
    expect(out.corridor).toBe('usdc-kes');
  });

  it('redacts email-shaped string values', () => {
    const out = redactProperties({ note: 'ops@stellar.org', anchor: 'cowrie' });
    expect(out.note).toBe('[REDACTED_EMAIL]');
    expect(out.anchor).toBe('cowrie');
  });
});

describe('trackAnalyticsEvent / trackFunnelEvent', () => {
  let plausible: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    plausible = vi.fn();
    // @ts-expect-error test shim
    globalThis.window = { plausible };
  });

  afterEach(() => {
    // @ts-expect-error cleanup
    delete globalThis.window;
  });

  it('forwards funnel events with corridor, anchor, and amount_bucket only', () => {
    trackFunnelEvent(FUNNEL_EVENTS.rateTableViewed, { corridor: 'usdc-ngn' });
    trackFunnelEvent(FUNNEL_EVENTS.corridorSelected, {
      corridor: 'usdc-kes',
      amount_bucket: amountBucket(100),
    });
    trackFunnelEvent(FUNNEL_EVENTS.executeDrawerOpened, {
      corridor: 'usdc-ngn',
      anchor: 'cowrie.exchange',
      amount_bucket: '100-500',
    });
    trackFunnelEvent(FUNNEL_EVENTS.executionConfirmed, {
      corridor: 'usdc-ngn',
      anchor: 'cowrie.exchange',
      amount_bucket: '100-500',
    });
    trackFunnelEvent(FUNNEL_EVENTS.executionCompleted, {
      corridor: 'usdc-ngn',
      anchor: 'cowrie.exchange',
      amount_bucket: '100-500',
    });
    trackFunnelEvent(FUNNEL_EVENTS.executionFailed, {
      corridor: 'usdc-ngn',
      anchor: 'cowrie.exchange',
      amount_bucket: '100-500',
      error_class: 'execute_error',
    });

    const calls = plausible.mock.calls as PlausibleCall[];
    expect(calls.map(([name]) => name)).toEqual([
      FUNNEL_EVENTS.rateTableViewed,
      FUNNEL_EVENTS.corridorSelected,
      FUNNEL_EVENTS.executeDrawerOpened,
      FUNNEL_EVENTS.executionConfirmed,
      FUNNEL_EVENTS.executionCompleted,
      FUNNEL_EVENTS.executionFailed,
    ]);

    for (const [, opts] of calls) {
      const props = opts?.props ?? {};
      expect(props).not.toHaveProperty('account');
      expect(props).not.toHaveProperty('publicKey');
      expect(
        Object.values(props).every((v) => typeof v !== 'string' || !/^G[A-Z0-9]{55}$/.test(v))
      ).toBe(true);
    }

    expect(calls[2]?.[1]?.props).toEqual({
      corridor: 'usdc-ngn',
      anchor: 'cowrie.exchange',
      amount_bucket: '100-500',
    });
  });

  it('strips PII before calling the provider', () => {
    const wallet = 'G' + 'B'.repeat(55);
    trackAnalyticsEvent('custom_event', {
      corridor: 'usdc-ngn',
      account: wallet,
      publicKey: wallet,
    });

    expect(plausible).toHaveBeenCalledWith('custom_event', {
      props: {
        corridor: 'usdc-ngn',
        account: '[REDACTED]',
        publicKey: '[REDACTED_WALLET]',
      },
    });
  });

  it('no-ops when plausible is unavailable', () => {
    // @ts-expect-error test shim
    globalThis.window = {};
    expect(() =>
      trackFunnelEvent(FUNNEL_EVENTS.rateTableViewed, { corridor: 'usdc-ngn' })
    ).not.toThrow();
  });
});

describe('on-ramp funnel events (#1491)', () => {
  let plausible: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    plausible = vi.fn();
    // @ts-expect-error test shim
    globalThis.window = { plausible };
  });

  afterEach(() => {
    // @ts-expect-error cleanup
    delete globalThis.window;
  });

  it('defines the seven documented names', () => {
    expect(ONRAMP_FUNNEL_EVENTS).toEqual({
      onrampRateTableViewed: 'onramp_rate_table_viewed',
      onrampTrustlinePrompted: 'onramp_trustline_prompted',
      onrampTrustlineAdded: 'onramp_trustline_added',
      onrampDepositStarted: 'onramp_deposit_started',
      onrampInstructionsShown: 'onramp_instructions_shown',
      onrampDepositCompleted: 'onramp_deposit_completed',
      onrampDepositFailed: 'onramp_deposit_failed',
    });
  });

  it('keeps the on-ramp names distinct from the off-ramp ones', () => {
    const offramp = new Set<string>(Object.values(FUNNEL_EVENTS));
    for (const name of Object.values(ONRAMP_FUNNEL_EVENTS)) {
      expect(offramp.has(name)).toBe(false);
      expect(name.startsWith('onramp_')).toBe(true);
    }
  });

  it('accepts every on-ramp name as a FunnelEventName', () => {
    const names: FunnelEventName[] = Object.values(ONRAMP_FUNNEL_EVENTS);
    for (const name of names) trackFunnelEvent(name, { direction: 'onramp' });

    expect((plausible.mock.calls as PlausibleCall[]).map(([name]) => name)).toEqual(names);
  });

  it('sends direction through redaction untouched', () => {
    trackFunnelEvent(ONRAMP_FUNNEL_EVENTS.onrampDepositStarted, {
      direction: 'onramp',
      corridor: 'usdc-ngn',
      anchor: 'cowrie',
      amount_bucket: amountBucket(10000),
    });

    expect((plausible.mock.calls as PlausibleCall[])[0]).toEqual([
      'onramp_deposit_started',
      {
        props: {
          direction: 'onramp',
          corridor: 'usdc-ngn',
          anchor: 'cowrie',
          amount_bucket: '1000+',
        },
      },
    ]);
    expect(redactProperties({ direction: 'onramp' })).toEqual({ direction: 'onramp' });
  });

  it('still strips an account if one is passed alongside direction', () => {
    const wallet = 'G' + 'C'.repeat(55);
    expect(redactProperties({ direction: 'onramp', account: wallet, owner: wallet })).toEqual({
      direction: 'onramp',
      account: '[REDACTED]',
      owner: '[REDACTED_WALLET]',
    });
  });

  it('leaves direction out of off-ramp events that do not set it', () => {
    trackFunnelEvent(FUNNEL_EVENTS.rateTableViewed, { corridor: 'usdc-ngn' });
    expect((plausible.mock.calls as PlausibleCall[])[0]?.[1]?.props).toEqual({
      corridor: 'usdc-ngn',
    });
  });
});
