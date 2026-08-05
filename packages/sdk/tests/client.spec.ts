import { describe, it, expect, vi } from 'vitest';
import { StellarIntelClient, API_VERSION } from '../src/client';
import { StellarIntelApiError, StellarIntelResponseError } from '../src/errors';

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A client whose backoff is instant, so retry tests do not wait 500ms+. */
function makeClient(fetchImpl: typeof globalThis.fetch, maxRetries = 3) {
  return new StellarIntelClient({
    baseUrl: 'https://api.test',
    fetch: fetchImpl,
    maxRetries,
    sleep: async () => {},
  });
}

const INTENT = {
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '100',
  sender: 'GSENDER',
  recipient: 'GRECIPIENT',
};

const INTENT_OK = { route: {}, unsignedTx: 'AAAA', quoteId: 'abc' };

describe('StellarIntelClient — retries', () => {
  it('retries a 429 and succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: { code: 'RATE_LIMITED' } }))
      .mockResolvedValueOnce(jsonResponse(200, INTENT_OK));

    const result = await makeClient(fetchMock as never).submitOfframpIntent(INTENT);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual(INTENT_OK);
  });

  it('reuses one idempotency key across a call and its retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(200, INTENT_OK));

    await makeClient(fetchMock as never).submitOfframpIntent(INTENT);

    const keys = fetchMock.mock.calls.map(
      ([, init]) => (init as RequestInit).headers as Record<string, string>
    );
    expect(keys).toHaveLength(3);
    // This is the whole point: a retried request must not create a second
    // intent server-side, which only holds if the key does not change.
    expect(new Set(keys.map((h) => h['Idempotency-Key'])).size).toBe(1);
    expect(keys[0]!['Idempotency-Key']).toBeTruthy();
  });

  it('uses a fresh key for a second logical call', async () => {
    // mockImplementation, not mockResolvedValue: a Response body can only be
    // consumed once, so a shared instance fails on the second call.
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, INTENT_OK)
    );
    const client = makeClient(fetchMock as never);

    await client.submitOfframpIntent(INTENT);
    await client.submitOfframpIntent(INTENT);

    const keys = fetchMock.mock.calls.map(
      ([, init]) => ((init as RequestInit).headers as Record<string, string>)['Idempotency-Key']
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('honours a caller-supplied idempotency key', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, INTENT_OK)
    );

    await makeClient(fetchMock as never).submitOfframpIntent(INTENT, {
      idempotencyKey: 'caller-key',
    });

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('caller-key');
  });

  it('honours Retry-After over the exponential backoff', async () => {
    const slept: number[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': '2' }))
      .mockResolvedValueOnce(jsonResponse(200, INTENT_OK));

    const client = new StellarIntelClient({
      baseUrl: 'https://api.test',
      fetch: fetchMock as never,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    await client.submitOfframpIntent(INTENT);

    // 2s from the header, not the 500ms first backoff step.
    expect(slept).toEqual([2000]);
  });

  it('never retries a 400', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(400, { error: { code: 'NO_ROUTE', message: 'no anchor', requestId: 'r1' } })
    );

    await expect(makeClient(fetchMock as never).submitOfframpIntent(INTENT)).rejects.toBeInstanceOf(
      StellarIntelApiError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws the envelope after retries are exhausted', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(503, { error: { code: 'UNAVAILABLE', message: 'down', requestId: 'r2' } })
    );

    const error = await makeClient(fetchMock as never, 2)
      .submitOfframpIntent(INTENT)
      .catch((e: unknown) => e);

    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(error).toBeInstanceOf(StellarIntelApiError);
    expect((error as StellarIntelApiError).code).toBe('UNAVAILABLE');
    expect((error as StellarIntelApiError).requestId).toBe('r2');
  });

  it('surfaces a non-envelope body rather than swallowing it', async () => {
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response('<html>502 Bad Gateway</html>', { status: 502 })
    );

    const error = await makeClient(fetchMock as never, 0)
      .getRates('usdc-ngn')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StellarIntelResponseError);
    expect((error as StellarIntelResponseError).body).toContain('502 Bad Gateway');
  });
});

describe('StellarIntelClient — requests', () => {
  it('pins API-Version on every request', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { ok: true })
    );

    await makeClient(fetchMock as never).getHealth();

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['API-Version']).toBe(API_VERSION);
  });

  it('does not send an idempotency key on reads', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { rates: [] })
    );

    await makeClient(fetchMock as never).getRates('usdc-ngn');

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  it('url-encodes path parameters', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, {})
    );

    await makeClient(fetchMock as never).getAnchorHealth('a/b');

    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.test/api/v1/anchors/a%2Fb/health');
  });

  it('strips a trailing slash from baseUrl', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { ok: true })
    );

    const client = new StellarIntelClient({
      baseUrl: 'https://api.test/',
      fetch: fetchMock as never,
      sleep: async () => {},
    });
    await client.getHealth();

    // Not https://api.test//api/v1/health, which redirects — the exact defect
    // that made the reputation cron a silent no-op (#948).
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.test/api/v1/health');
  });

  it('sends type: offramp so the caller does not have to', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, INTENT_OK)
    );

    await makeClient(fetchMock as never).submitOfframpIntent(INTENT);

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ type: 'offramp', ...INTENT });
  });
});
