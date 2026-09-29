import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractSdfDirectoryHosts,
  fetchSdfAnchorDirectoryDomains,
} from '../scripts/lib/sdf-directory.mjs';

const FIXTURE = readFileSync(join(process.cwd(), 'tests/fixtures/survey/sdf-anchors.html'), 'utf8');

describe('extractSdfDirectoryHosts', () => {
  it('extracts plain, escaped and toml_file hosts, ignoring null websites', () => {
    expect(extractSdfDirectoryHosts(FIXTURE)).toEqual([
      'aps.money',
      'bitnovo.com',
      'toml.bitnovo.example',
    ]);
  });

  it('dedupes, lower-cases, strips www. and sorts', () => {
    const html = `
      "website":"https://APS.example/path"
      \\"website\\":\\"https://www.aps.example/\\"
      "website":"https://other.example/"
    `;
    expect(extractSdfDirectoryHosts(html)).toEqual(['aps.example', 'other.example']);
  });

  it('ignores malformed URLs and non-http schemes', () => {
    const html = `"website":"not a url" "website":"ftp://files.example/" "website":"https://ok.example/"`;
    expect(extractSdfDirectoryHosts(html)).toEqual(['ok.example']);
  });
});

describe('fetchSdfAnchorDirectoryDomains', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs anchors.stellar.org and maps hosts to candidates', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => FIXTURE,
    });
    vi.stubGlobal('fetch', fetchMock);

    const domains = await fetchSdfAnchorDirectoryDomains();

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://anchors.stellar.org/');
    expect(fetchMock.mock.calls[0][1].headers['User-Agent']).toBe(
      'stellar-intel-anchor-survey/1.0'
    );
    expect(domains).toEqual([
      { domain: 'aps.money', sources: ['sdf-anchor-directory'] },
      { domain: 'bitnovo.com', sources: ['sdf-anchor-directory'] },
      { domain: 'toml.bitnovo.example', sources: ['sdf-anchor-directory'] },
    ]);
  });

  it('throws on a non-200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '' })
    );

    await expect(fetchSdfAnchorDirectoryDomains()).rejects.toThrow(
      'sdf anchor directory fetch failed: HTTP 503'
    );
  });
});
