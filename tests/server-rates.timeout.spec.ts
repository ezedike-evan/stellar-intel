/**
 * Per-tier timeout / retry policy (B043).
 *
 * The server-side rate path uses configurable timeouts per tier and retries each
 * idempotent read once on transient failures (network error, timeout, 5xx).
 * Deterministic 4xx responses are never retried. All anchor calls are mocked;
 * the suite performs no network I/O.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Anchor, Corridor, Sep1TomlData } from '@/types';
import { SepError } from '@/lib/stellar/errors';

vi.mock('@/lib/stellar/anchors', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/stellar/anchors')>();
  return { ...actual, getAnchorsByCorridorId: vi.fn(), getCorridorById: vi.fn() };
});
vi.mock('@/lib/stellar/sep1', () => ({ resolveAnchor: vi.fn() }));
vi.mock('@/lib/stellar/sep38', () => ({
  assertSep38Capable: vi.fn(),
  getSep38Price: vi.fn(),
}));
vi.mock('@/lib/stellar/sep24', () => ({ getSep24Info: vi.fn() }));
vi.mock('@/lib/fx/rates', () => ({ getUsdFxRate: vi.fn() }));

import { fetchCorridorRates, serverRatesConfig } from '@/lib/stellar/server-rates';
import { getAnchorsByCorridorId, getCorridorById } from '@/lib/stellar/anchors';
import { resolveAnchor } from '@/lib/stellar/sep1';
import { assertSep38Capable, getSep38Price } from '@/lib/stellar/sep38';
import { getSep24Info } from '@/lib/stellar/sep24';
import { getUsdFxRate } from '@/lib/fx/rates';

const anchor: Anchor = {
  id: 'test',
  name: 'Test Anchor',
  homeDomain: 'test.example.com',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
};

const corridor: Corridor = {
  id: 'usdc-ngn',
  from: 'USDC',
  to: 'NGN',
  countryCode: 'NG',
  countryName: 'Nigeria',
};

const goodToml: Sep1TomlData = {
  domain: 'test.example.com',
  TRANSFER_SERVER_SEP0024: 'https://test.example.com/sep24',
  ANCHOR_QUOTE_SERVER: 'https://test.example.com/sep38',
  WEB_AUTH_ENDPOINT: null,
  SIGNING_KEY: null,
  NETWORK_PASSPHRASE: null,
  ORG_URL: null,
  ORG_SUPPORT_EMAIL: null,
  ORG_SUPPORT_URL: null,
  CURRENCIES: [],
  capabilities: { sep10: false, sep24: true, sep38: true, sep12: false, sep6: false, sep31: false },
  seps: ['sep24', 'sep38'],
};

const goodPrice = {
  buy_amount: '160000',
  sell_amount: '100',
  price: '1600',
  total_price: '1600',
};

const goodSep24Info = {
  withdraw: { USDC: { enabled: true } },
} as unknown as Awaited<ReturnType<typeof getSep24Info>>;

beforeEach(() => {
  vi.mocked(getAnchorsByCorridorId).mockReturnValue([anchor]);
  vi.mocked(getCorridorById).mockReturnValue(corridor);
  vi.mocked(resolveAnchor).mockResolvedValue(goodToml);
  vi.mocked(assertSep38Capable).mockReturnValue('https://test.example.com/sep38');
  vi.mocked(getSep38Price).mockResolvedValue(goodPrice);
  vi.mocked(getSep24Info).mockResolvedValue(goodSep24Info);
  vi.mocked(getUsdFxRate).mockResolvedValue(1600);
});

afterEach(() => {
  vi.clearAllMocks();
  // Restore defaults so other tests are not affected by per-test overrides.
  serverRatesConfig.toml.timeoutMs = 8_000;
  serverRatesConfig.toml.retryAttempts = 1;
  serverRatesConfig.sep38.timeoutMs = 8_000;
  serverRatesConfig.sep38.retryAttempts = 1;
  serverRatesConfig.sep24Info.timeoutMs = 8_000;
  serverRatesConfig.sep24Info.retryAttempts = 1;
});

// ─── Config defaults ────────────────────────────────────────────────────────

describe('serverRatesConfig', () => {
  it('exposes a tunable timeout per tier with the previous 8s default', () => {
    expect(serverRatesConfig.toml.timeoutMs).toBe(8_000);
    expect(serverRatesConfig.sep38.timeoutMs).toBe(8_000);
    expect(serverRatesConfig.sep24Info.timeoutMs).toBe(8_000);
  });

  it('defaults to one retry per tier', () => {
    expect(serverRatesConfig.toml.retryAttempts).toBe(1);
    expect(serverRatesConfig.sep38.retryAttempts).toBe(1);
    expect(serverRatesConfig.sep24Info.retryAttempts).toBe(1);
  });
});

// ─── SEP-38 price tier ───────────────────────────────────────────────────────

describe('SEP-38 /price — one retry on transient failure, no retry on 4xx', () => {
  it('recovers when the first network error is retried successfully', async () => {
    const networkErr = new SepError('connection reset', 'NETWORK_ERROR', 0, null);
    vi.mocked(getSep38Price).mockRejectedValueOnce(networkErr).mockResolvedValueOnce(goodPrice);

    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.rates).toHaveLength(1);
    expect(result.rates[0]?.totalReceived).toBe(160000);
    expect(getSep38Price).toHaveBeenCalledTimes(2);
  });

  it('gives up after one retry per context when the network error persists', async () => {
    const networkErr = new SepError('connection reset', 'NETWORK_ERROR', 0, null);
    vi.mocked(getSep38Price).mockRejectedValue(networkErr);
    // Isolate the SEP-38 tier so failure there is terminal for this anchor.
    vi.mocked(getSep24Info).mockRejectedValue(new Error('indicative fallback unavailable'));

    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.rates).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    // Each of the 3 SEP-38 contexts is attempted once and retried once.
    expect(getSep38Price).toHaveBeenCalledTimes(6);
  });

  it('does not retry a deterministic 4xx and moves to the next context', async () => {
    const badContext = new SepError('unsupported context', 'NOT_SUPPORTED', 400, null);
    vi.mocked(getSep38Price).mockRejectedValue(badContext);
    // Isolate the SEP-38 tier so failure there is terminal for this anchor.
    vi.mocked(getSep24Info).mockRejectedValue(new Error('indicative fallback unavailable'));

    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.rates).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    // One unretried attempt per SEP-38 context (3 contexts).
    expect(getSep38Price).toHaveBeenCalledTimes(3);
  });

  it('retries a 5xx transient error once per context', async () => {
    const serverErr = new SepError('anchor overload', 'SERVER_ERROR', 503, null);
    vi.mocked(getSep38Price).mockRejectedValue(serverErr);
    // Isolate the SEP-38 tier so failure there is terminal for this anchor.
    vi.mocked(getSep24Info).mockRejectedValue(new Error('indicative fallback unavailable'));

    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.rates).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    // Each of the 3 contexts is attempted once and retried once on 5xx.
    expect(getSep38Price).toHaveBeenCalledTimes(6);
  });
});

// ─── SEP-24 info tier (indicative fallback) ───────────────────────────────────

describe('SEP-24 /info — one retry on transient failure, no retry on 4xx', () => {
  beforeEach(() => {
    // Make SEP-38 unavailable so the path falls back to the indicative tier.
    vi.mocked(assertSep38Capable).mockImplementation(() => {
      throw new Error('no SEP-38 quote server');
    });
  });

  it('recovers when the first /info network error is retried', async () => {
    const networkErr = new SepError('connection reset', 'NETWORK_ERROR', 0, null);
    vi.mocked(getSep24Info).mockRejectedValueOnce(networkErr).mockResolvedValueOnce(goodSep24Info);

    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.rates).toHaveLength(1);
    expect(result.rates[0]?.source).toBe('sep24-fee');
    expect(getSep24Info).toHaveBeenCalledTimes(2);
  });

  it('does not retry a deterministic 4xx from /info', async () => {
    const fourOhFour = new SepError('not found', 'NOT_FOUND', 404, null);
    vi.mocked(getSep24Info).mockRejectedValue(fourOhFour);

    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.rates).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(getSep24Info).toHaveBeenCalledTimes(1);
  });
});

// ─── TOML tier ───────────────────────────────────────────────────────────────

describe('TOML resolution — one retry on transient failure', () => {
  it('recovers when the first TOML network error is retried', async () => {
    const networkErr = new Error('fetch failed: ECONNRESET');
    vi.mocked(resolveAnchor).mockRejectedValueOnce(networkErr).mockResolvedValueOnce(goodToml);

    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.rates).toHaveLength(1);
    expect(resolveAnchor).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-network TOML failure', async () => {
    vi.mocked(resolveAnchor).mockRejectedValue(new Error('TOML parse error'));

    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.rates).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(resolveAnchor).toHaveBeenCalledTimes(1);
  });
});

// ─── Timeout behavior ─────────────────────────────────────────────────────────

describe('per-tier timeout', () => {
  it('uses the configured SEP-38 timeout and surfaces a timeout error', async () => {
    serverRatesConfig.sep38.timeoutMs = 5;
    vi.mocked(getSep38Price).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(goodPrice), 50))
    );
    // Isolate the SEP-38 tier so failure there is terminal for this anchor.
    vi.mocked(getSep24Info).mockRejectedValue(new Error('indicative fallback unavailable'));

    const result = await fetchCorridorRates('usdc-ngn', '100');

    // Slow SEP-38 read times out per the configured 5ms budget.
    expect(result.rates).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('timed out after 5ms');
  });

  it('retries a timeout on the next attempt with the same tier budget', async () => {
    serverRatesConfig.sep38.timeoutMs = 5;
    vi.mocked(getSep38Price)
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve(goodPrice), 50))
      )
      .mockResolvedValueOnce(goodPrice);

    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.rates).toHaveLength(1);
    expect(getSep38Price).toHaveBeenCalledTimes(2);
  });
});
