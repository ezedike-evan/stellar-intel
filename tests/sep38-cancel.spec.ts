import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteSep38Quote, _clearSep38Cache } from '@/lib/stellar/sep38';

const QUOTE_SERVER = 'https://anchor.example.com/sep38';
const JWT = 'eyJ.fake.jwt';
const QUOTE_ID = 'de762cda-a193-4961-861e-57b31fed6eb3';

let lastUrl = '';
let lastInit: RequestInit | undefined;

function mockFetch(init?: { ok?: boolean; status?: number }) {
  const fn = vi.fn((url: string, reqInit?: RequestInit) => {
    lastUrl = url;
    lastInit = reqInit;
    return Promise.resolve({
      ok: init?.ok ?? true,
      status: init?.status ?? 204,
      json: async () => ({}),
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  lastUrl = '';
  lastInit = undefined;
  _clearSep38Cache();
  vi.restoreAllMocks();
});

describe('deleteSep38Quote', () => {
  it('resolves to void on a successful 204 cancel', async () => {
    mockFetch({ ok: true, status: 204 });

    await expect(deleteSep38Quote(QUOTE_SERVER, QUOTE_ID, JWT)).resolves.toBeUndefined();
  });

  it('resolves to void on a 200 cancel', async () => {
    mockFetch({ ok: true, status: 200 });

    await expect(deleteSep38Quote(QUOTE_SERVER, QUOTE_ID, JWT)).resolves.toBeUndefined();
  });

  it('is idempotent: a repeat cancel returning 404 does not throw', async () => {
    // First call succeeds, second call hits an already-cancelled quote (404).
    const fn = vi.fn();
    fn.mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });
    fn.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    vi.stubGlobal('fetch', fn);

    await expect(deleteSep38Quote(QUOTE_SERVER, QUOTE_ID, JWT)).resolves.toBeUndefined();
    await expect(deleteSep38Quote(QUOTE_SERVER, QUOTE_ID, JWT)).resolves.toBeUndefined();
  });

  it('treats a 410 Gone response as an already-cancelled no-op', async () => {
    mockFetch({ ok: false, status: 410 });

    await expect(deleteSep38Quote(QUOTE_SERVER, QUOTE_ID, JWT)).resolves.toBeUndefined();
  });

  it('sends a DELETE to /quote/:id with the SEP-10 JWT', async () => {
    mockFetch();

    await deleteSep38Quote(QUOTE_SERVER, QUOTE_ID, JWT);

    expect(lastUrl).toBe(`https://anchor.example.com/sep38/quote/${QUOTE_ID}`);
    expect(lastInit?.method).toBe('DELETE');

    const headers = lastInit?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${JWT}`);
  });

  it('url-encodes the quote id in the path', async () => {
    mockFetch();

    await deleteSep38Quote(QUOTE_SERVER, 'id with/slash', JWT);

    expect(lastUrl).toBe('https://anchor.example.com/sep38/quote/id%20with%2Fslash');
  });

  it('requires a quote id', async () => {
    mockFetch();

    await expect(deleteSep38Quote(QUOTE_SERVER, '', JWT)).rejects.toThrow(/quote id is required/);
  });

  it('requires a SEP-10 JWT', async () => {
    mockFetch();

    await expect(deleteSep38Quote(QUOTE_SERVER, QUOTE_ID, '')).rejects.toThrow(/JWT is required/);
  });

  it('throws on an unauthorized (401) response', async () => {
    mockFetch({ ok: false, status: 401 });

    await expect(deleteSep38Quote(QUOTE_SERVER, QUOTE_ID, JWT)).rejects.toThrow(
      /HTTP 401.*SEP-38 \/quote cancellation/
    );
  });

  it('throws on a server (500) response', async () => {
    mockFetch({ ok: false, status: 500 });

    await expect(deleteSep38Quote(QUOTE_SERVER, QUOTE_ID, JWT)).rejects.toThrow(/HTTP 500/);
  });
});
