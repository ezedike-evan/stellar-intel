import { describe, it, expect, vi } from 'vitest';
import {
  InMemoryProbeStore,
  probeAllAnchorDeposits,
  probeDepositAvailability,
  type DepositProbeDeps,
  type ProbeSample,
  type ProbeSampleStore,
} from '@/lib/reputation/probe';
import { ANCHORS } from '@/constants/anchors';
import type { Sep24InfoResponse } from '@/lib/stellar/sep24';
import type { Anchor, Sep1TomlData } from '@/types';

const { serviceDomain: _serviceDomain, ...baseAnchor } = ANCHORS[0]!;
const anchor: Anchor = { ...baseAnchor, assetCode: 'USDC' };

const tomlWithSep24 = {
  ok: true as const,
  data: { TRANSFER_SERVER_SEP0024: 'https://anchor.example/sep24' } as Sep1TomlData,
};

const tomlWithoutSep24 = {
  ok: true as const,
  data: { TRANSFER_SERVER_SEP0024: null } as Sep1TomlData,
};

function info(deposit: Sep24InfoResponse['deposit']): Sep24InfoResponse {
  return {
    deposit,
    withdraw: {},
    fee: { enabled: false },
    transaction: { enabled: true },
    transactions: { enabled: true },
  };
}

const infoOk = info({ USDC: { enabled: true }, EURC: { enabled: false } });

function deps(overrides: DepositProbeDeps = {}): DepositProbeDeps {
  return {
    fetchToml: async () => tomlWithSep24,
    fetchInfo: vi.fn(async () => infoOk),
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

describe('probeDepositAvailability', () => {
  it('records a reachable sample for an enabled deposit asset', async () => {
    const store = new InMemoryProbeStore();

    const samples = await probeDepositAvailability(anchor, store, deps());

    const usdc = samples.find((s) => s.corridor === 'deposit:USDC');
    expect(usdc).toMatchObject({ reachable: true, failureType: null });
    expect(usdc!.error).toBeUndefined();
    expect(store.samples()).toHaveLength(samples.length);
  });

  it('records an unreachable sample with the error text for a disabled asset', async () => {
    const store = new InMemoryProbeStore();

    const samples = await probeDepositAvailability(anchor, store, deps());

    const eurc = samples.find((s) => s.corridor === 'deposit:EURC');
    expect(eurc).toMatchObject({
      reachable: false,
      failureType: 'unknown',
      error: 'deposit disabled for EURC',
    });
  });

  it('records one sample per /info deposit asset', async () => {
    const store = new InMemoryProbeStore();

    const samples = await probeDepositAvailability(anchor, store, deps());

    expect(samples.map((s) => s.corridor).sort()).toEqual(['deposit:EURC', 'deposit:USDC']);
  });

  it('takes the code from a stellar:CODE:ISSUER key and maps native to XLM', async () => {
    const store = new InMemoryProbeStore();
    const fetchInfo = async () =>
      info({
        'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN': { enabled: true },
        'stellar:native': { enabled: true },
      });

    const samples = await probeDepositAvailability(anchor, store, deps({ fetchInfo }));

    expect(samples.map((s) => s.corridor).sort()).toEqual(['deposit:USDC', 'deposit:XLM']);
  });

  it('records the registered asset as disabled when /info lists no deposit assets', async () => {
    const store = new InMemoryProbeStore();

    const samples = await probeDepositAvailability(
      anchor,
      store,
      deps({ fetchInfo: async () => info({}) })
    );

    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      corridor: 'deposit:USDC',
      reachable: false,
      error: 'deposit disabled for USDC',
    });
  });

  it('classifies an /info failure instead of throwing', async () => {
    const store = new InMemoryProbeStore();
    const fetchInfo = vi.fn(async (): Promise<Sep24InfoResponse> => {
      throw new Error('request ETIMEDOUT');
    });

    const samples = await probeDepositAvailability(anchor, store, deps({ fetchInfo }));

    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      reachable: false,
      failureType: 'timeout',
      error: 'request ETIMEDOUT',
      corridor: 'deposit:USDC',
    });
  });

  it('classifies a stellar.toml failure', async () => {
    const store = new InMemoryProbeStore();

    const samples = await probeDepositAvailability(
      anchor,
      store,
      deps({
        fetchToml: async () => ({ ok: false, error: 'getaddrinfo ENOTFOUND anchor.example' }),
      })
    );

    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ reachable: false, failureType: 'dns' });
  });

  it('records one unreachable sample for an anchor without SEP-24 and never calls /info', async () => {
    const store = new InMemoryProbeStore();
    const fetchInfo = vi.fn(async () => infoOk);

    const samples = await probeDepositAvailability(
      anchor,
      store,
      deps({ fetchToml: async () => tomlWithoutSep24, fetchInfo })
    );

    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ reachable: false, corridor: 'deposit:USDC' });
    expect(samples[0]!.error).toContain('TRANSFER_SERVER_SEP0024');
    expect(fetchInfo).not.toHaveBeenCalled();
  });

  it('tags every sample with a deposit corridor so none reads as an uptime sample', async () => {
    const store = new InMemoryProbeStore();

    await probeDepositAvailability(anchor, store, deps());
    await probeDepositAvailability(
      anchor,
      store,
      deps({ fetchToml: async () => ({ ok: false, error: 'boom' }) })
    );

    expect(store.samples().every((s) => s.corridor?.startsWith('deposit:'))).toBe(true);
  });

  it('measures latency with the injected clock', async () => {
    const store = new InMemoryProbeStore();
    const ticks = [1_000, 1_250];
    const now = () => ticks.shift() ?? 1_250;

    const samples = await probeDepositAvailability(anchor, store, deps({ now }));

    expect(samples.every((s) => s.latencyMs === 250 && s.at === 1_250)).toBe(true);
  });
});

describe('probeAllAnchorDeposits', () => {
  const good = { ...anchor, id: 'good', homeDomain: 'good.example' };
  const bad = { ...anchor, id: 'bad', homeDomain: 'bad.example' };

  it('does not abort the fleet run when one anchor fails to resolve', async () => {
    const store = new InMemoryProbeStore();
    const fetchToml = vi.fn(async (domain: string) => {
      if (domain === 'bad.example') throw new Error('toml failure');
      return tomlWithSep24;
    });

    const samples = await probeAllAnchorDeposits(store, deps({ fetchToml }), [bad, good]);

    expect(samples.filter((s) => s.domain === 'good.example')).toHaveLength(2);
    expect(samples.find((s) => s.domain === 'bad.example')).toMatchObject({
      reachable: false,
      error: 'toml failure',
    });
  });

  it('swallows a store failure for one anchor and still records the rest', async () => {
    const recorded: ProbeSample[] = [];
    const store: ProbeSampleStore = {
      record(sample) {
        if (sample.domain === 'bad.example') throw new Error('store down');
        recorded.push(sample);
      },
      samples: () => recorded,
    };

    const samples = await probeAllAnchorDeposits(store, deps(), [bad, good]);

    expect(samples.every((s) => s.domain === 'good.example')).toBe(true);
    expect(recorded).toHaveLength(2);
  });

  it('probes every registered anchor by default', async () => {
    const store = new InMemoryProbeStore();
    const fetchInfo = vi.fn(async () => infoOk);

    await probeAllAnchorDeposits(store, deps({ fetchInfo }));

    expect(fetchInfo).toHaveBeenCalledTimes(ANCHORS.length);
  });
});
