import { describe, it, expect } from 'vitest';
import { InMemoryProbeStore, probeSep31Info, probeAllAnchorSep31 } from '@/lib/reputation/probe';
import type { TomlResult } from '@/lib/stellar/sep1';
import type { Anchor, Sep1TomlData, Sep31Info } from '@/types';

function tomlData(over: Partial<Sep1TomlData> = {}): Sep1TomlData {
  return {
    domain: 'anchor.example',
    TRANSFER_SERVER_SEP0024: null,
    TRANSFER_SERVER: null,
    DIRECT_PAYMENT_SERVER: 'https://anchor.example/sep31',
    ANCHOR_QUOTE_SERVER: null,
    WEB_AUTH_ENDPOINT: null,
    SIGNING_KEY: 'GABCDEF',
    NETWORK_PASSPHRASE: null,
    ORG_URL: null,
    ORG_SUPPORT_EMAIL: null,
    ORG_SUPPORT_URL: null,
    CURRENCIES: [{ code: 'USDC', issuer: 'GISSUER' }],
    capabilities: {
      sep10: true,
      sep24: false,
      sep38: false,
      sep12: true,
      sep6: false,
      sep31: true,
    },
    seps: ['sep10', 'sep31'],
    ...over,
  };
}

function testAnchor(over: Partial<Anchor> = {}): Anchor {
  return {
    id: 'test-anchor',
    name: 'Test Anchor',
    homeDomain: 'anchor.example',
    corridors: ['usdc-ngn'],
    assetCode: 'USDC',
    assetIssuer: 'GISSUER',
    seps: ['sep10', 'sep31'],
    ...over,
  };
}

const tomlSep31 = async (): Promise<TomlResult> => ({ ok: true, data: tomlData() });
const tomlNoSep31 = async (): Promise<TomlResult> => ({
  ok: true,
  data: tomlData({
    DIRECT_PAYMENT_SERVER: null,
    capabilities: { ...tomlData().capabilities, sep31: false },
  }),
});
const tomlUnreachable = async (): Promise<TomlResult> => ({ ok: false, error: 'HTTP 503' });

const goodInfo: Sep31Info = {
  receive: {
    USDC: { enabled: true, min_amount: 0.1, max_amount: 1000, fee_fixed: 5, fee_percent: 1 },
  },
};

describe('SEP-31 info probe', () => {
  it('records reachable=true on a good fixture and logs the receive asset codes', async () => {
    const store = new InMemoryProbeStore();
    const sample = await probeSep31Info('anchor.example', store, {
      fetchToml: tomlSep31,
      fetchInfo: async () => goodInfo,
    });

    expect(sample.reachable).toBe(true);
    expect(sample.failureType ?? null).toBeNull();
    expect(store.samples('anchor.example')).toHaveLength(1);
  });

  it('records unreachable with an http failure type on a 500 from /info', async () => {
    const store = new InMemoryProbeStore();
    const sample = await probeSep31Info('anchor.example', store, {
      fetchToml: tomlSep31,
      fetchInfo: async () => {
        throw new Error('SEP error: HTTP 500');
      },
    });

    expect(sample.reachable).toBe(false);
    expect(sample.failureType).toBe('http');
    expect(sample.error).toContain('500');
  });

  it('is unreachable when the toml does not advertise DIRECT_PAYMENT_SERVER', async () => {
    const store = new InMemoryProbeStore();
    const sample = await probeSep31Info('anchor.example', store, { fetchToml: tomlNoSep31 });

    expect(sample.reachable).toBe(false);
    expect(sample.error).toContain('DIRECT_PAYMENT_SERVER');
  });

  it('classifies a toml fetch failure like the other probes', async () => {
    const store = new InMemoryProbeStore();
    const sample = await probeSep31Info('anchor.example', store, { fetchToml: tomlUnreachable });

    expect(sample.reachable).toBe(false);
    expect(sample.failureType).toBe('http');
    expect(sample.error).toBe('HTTP 503');
  });

  it('probeAllAnchorSep31 probes only anchors whose seps include sep31', async () => {
    const store = new InMemoryProbeStore();
    const withSep31 = testAnchor({ id: 'has-sep31', homeDomain: 'a.example', seps: ['sep31'] });
    const withoutSep31 = testAnchor({ id: 'no-sep31', homeDomain: 'b.example', seps: ['sep24'] });

    const samples = await probeAllAnchorSep31(
      store,
      { fetchToml: tomlSep31, fetchInfo: async () => goodInfo },
      [withSep31, withoutSep31]
    );

    expect(samples).toHaveLength(1);
    expect(samples[0]?.domain).toBe('a.example');
    expect(store.samples('b.example')).toHaveLength(0);
  });

  it('probeAllAnchorSep31 uses serviceDomain over homeDomain when present', async () => {
    const store = new InMemoryProbeStore();
    const anchor = testAnchor({
      homeDomain: 'home.example',
      serviceDomain: 'service.example',
      seps: ['sep31'],
    });

    await probeAllAnchorSep31(store, { fetchToml: tomlSep31, fetchInfo: async () => goodInfo }, [
      anchor,
    ]);

    expect(store.samples('service.example')).toHaveLength(1);
    expect(store.samples('home.example')).toHaveLength(0);
  });
});
