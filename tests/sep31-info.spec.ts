import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSep31Info, sep31ReceiveAssets } from '@/lib/stellar/sep31';
import { SepError } from '@/lib/stellar/errors';
import fixture from './fixtures/sep31/info.json';

const DIRECT_PAYMENT_SERVER = 'https://anchor.example.com/sep31';

function mockFetch(response: unknown, init?: { ok?: boolean; status?: number }) {
  const fn = vi.fn(async () => ({
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => response,
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getSep31Info', () => {
  it('parses a real SEP-31 anchor /info response cleanly', async () => {
    mockFetch(fixture);

    const info = await getSep31Info(DIRECT_PAYMENT_SERVER);

    expect(info.receive).toEqual({
      USDC: {
        enabled: true,
        min_amount: 0.1,
        max_amount: 1000,
        fee_fixed: 5,
        fee_percent: 1,
      },
    });
  });

  it('requests the /info path on the direct payment server', async () => {
    const fetchFn = mockFetch(fixture);

    await getSep31Info(DIRECT_PAYMENT_SERVER);

    expect(fetchFn).toHaveBeenCalledWith(
      'https://anchor.example.com/sep31/info',
      expect.anything()
    );
  });

  it('strips a trailing slash from the direct payment server before appending /info', async () => {
    const fetchFn = mockFetch(fixture);

    await getSep31Info('https://anchor.example.com/sep31/');

    expect(fetchFn).toHaveBeenCalledWith(
      'https://anchor.example.com/sep31/info',
      expect.anything()
    );
  });

  it('rejects a non-https direct payment server before fetching', async () => {
    const fetchFn = mockFetch(fixture);

    await expect(getSep31Info('http://anchor.example.com/sep31')).rejects.toThrow(/must use https/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws a SepError on a non-2xx response', async () => {
    mockFetch({ error: 'internal error' }, { ok: false, status: 500 });

    await expect(getSep31Info(DIRECT_PAYMENT_SERVER)).rejects.toBeInstanceOf(SepError);
  });

  it('throws a timeout error when the request aborts', async () => {
    const fn = vi.fn(async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    });
    vi.stubGlobal('fetch', fn);

    await expect(getSep31Info(DIRECT_PAYMENT_SERVER)).rejects.toThrow(/timed out/);
  });
});

describe('sep31ReceiveAssets', () => {
  it('returns codes for enabled receive assets', () => {
    expect(sep31ReceiveAssets({ receive: { USDC: { enabled: true } } })).toEqual(['USDC']);
  });

  it('excludes assets explicitly disabled', () => {
    expect(
      sep31ReceiveAssets({
        receive: { USDC: { enabled: true }, NGNC: { enabled: false } },
      })
    ).toEqual(['USDC']);
  });

  it('treats a missing enabled flag as enabled', () => {
    expect(sep31ReceiveAssets({ receive: { USDC: {} } })).toEqual(['USDC']);
  });
});
