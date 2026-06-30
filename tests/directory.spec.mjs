import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchDirectoryCandidates } from '../scripts/lib/directory.mjs';

describe('fetchDirectoryCandidates', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the anchor-tagged candidate set from the directory API', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        _embedded: {
          records: [
            { domain: 'alpha.example', name: 'Alpha', address: 'GAALPHA' },
            { domain: 'beta.example', name: 'Beta', address: 'GABETA' },
            { domain: 'alpha.example', name: 'Alpha Dup', address: 'GAALPHA2' },
          ],
        },
      }),
    });

    const candidates = await fetchDirectoryCandidates();

    expect(candidates).toEqual([
      { domain: 'alpha.example', name: 'Alpha', address: 'GAALPHA' },
      { domain: 'beta.example', name: 'Beta', address: 'GABETA' },
    ]);
  });
});
