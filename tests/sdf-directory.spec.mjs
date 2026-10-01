import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  extractSdfDirectoryHosts,
  fetchSdfAnchorDirectoryDomains,
} from '../scripts/lib/sdf-directory.mjs';

const fixture = readFileSync(join(process.cwd(), 'tests/fixtures/survey/sdf-anchors.html'), 'utf8');

describe('extractSdfDirectoryHosts', () => {
  it('extracts plain and escaped website/toml_file hosts and ignores nulls', () => {
    expect(extractSdfDirectoryHosts(fixture)).toEqual([
      'aps.money',
      'bitnovo.com',
      'toml.example-anchor.io',
    ]);
  });

  it('lower-cases, strips www. and dedupes', () => {
    const html =
      '"website":"https://WWW.Alpha.example/a" \\"toml_file\\":\\"https://alpha.example/.well-known/stellar.toml\\"';
    expect(extractSdfDirectoryHosts(html)).toEqual(['alpha.example']);
  });
});

describe('fetchSdfAnchorDirectoryDomains', () => {
  it('fetches the directory and tags each host with its source', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => fixture,
    });

    const candidates = await fetchSdfAnchorDirectoryDomains({ fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith('https://anchors.stellar.org/', {
      headers: { 'User-Agent': 'stellar-intel-anchor-survey/1.0' },
    });
    expect(candidates).toEqual([
      { domain: 'aps.money', sources: ['sdf-anchor-directory'] },
      { domain: 'bitnovo.com', sources: ['sdf-anchor-directory'] },
      { domain: 'toml.example-anchor.io', sources: ['sdf-anchor-directory'] },
    ]);
  });

  it('throws on a non-200 response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '' });
    await expect(fetchSdfAnchorDirectoryDomains({ fetchImpl })).rejects.toThrow(/HTTP 503/);
  });
});
