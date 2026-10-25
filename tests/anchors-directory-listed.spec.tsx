import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { AnchorCensus, ListedAnchor } from '@/types';

const { ISSUER_ENTRY, CRYPTO_ENTRY } = vi.hoisted(() => {
  const ISSUER_KEY = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

  const codes = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH'];

  const ISSUER_ENTRY: ListedAnchor = {
    id: 'zeta-issuer',
    name: 'Zeta Issuer',
    kind: 'issuer',
    domains: ['issuer.example', 'assets.issuer.example'],
    orgUrl: 'https://issuer.example',
    verifiedAt: '2026-10-01',
    assets: codes.map((code) => ({
      code,
      issuer: ISSUER_KEY,
      anchorAssetType: null,
      anchorAsset: null,
    })),
    registeredAnchorId: 'cowrie',
  };

  const CRYPTO_ENTRY: ListedAnchor = {
    id: 'alpha-rails',
    name: 'Alpha Rails',
    kind: 'crypto-rails',
    domains: ['rails.example'],
    orgUrl: null,
    verifiedAt: '2026-10-02',
    assets: [{ code: 'BCH', issuer: ISSUER_KEY, anchorAssetType: 'crypto', anchorAsset: 'BCH' }],
    cryptoRails: [
      {
        sep: 'sep6',
        transferServer: 'https://rails.example/sep6',
        depositAssets: ['BCH', 'USDT'],
        withdrawAssets: ['BCH', 'ETH'],
        withdrawTypes: ['crypto'],
      },
      {
        sep: 'sep24',
        transferServer: 'https://rails.example/sep24',
        depositAssets: [],
        withdrawAssets: ['BCH'],
        withdrawTypes: ['crypto'],
      },
    ],
  };
  return { ISSUER_ENTRY, CRYPTO_ENTRY };
});

vi.mock('@/constants/listed-anchors', () => ({ LISTED_ANCHORS: [ISSUER_ENTRY, CRYPTO_ENTRY] }));

import AnchorDirectoryPage, { metadata } from '@/app/anchors/directory/page';

afterEach(() => cleanup());

const CENSUS: AnchorCensus = {
  generatedAt: '2026-09-27T12:00:00.000Z',
  sources: ['stellar.expert'],
  counts: { routable: 0, healthOnly: 0, listed: 0, excluded: 0 },
  rows: [],
};

async function renderPage(searchParams?: { tier?: string; kind?: string }) {
  render(await AnchorDirectoryPage({ census: CENSUS, ...(searchParams ? { searchParams } : {}) }));
  return screen.getByRole('table', { name: 'Listed operators' });
}

describe('listed operators on the anchor directory (#1585)', () => {
  it('mentions issuers and crypto-only anchors in the metadata', () => {
    expect(String(metadata.description)).toMatch(/issue assets/i);
    expect(String(metadata.description)).toMatch(/crypto-only/i);
  });

  it('adds a labelled section with its explanation and counts', async () => {
    await renderPage();

    const section = screen.getByRole('region', { name: 'Issuers and crypto-only anchors' });
    expect(within(section).getByRole('heading', { level: 2 }).id).toBe('listed-heading');
    expect(
      within(section).getByText(/never used for quotes or routing/, { exact: false }).textContent
    ).toContain(
      'Operators that issue assets on Stellar or run crypto-only rails, with no fiat payout.'
    );
    expect(within(section).getByText('1 issuers · 1 crypto-only')).toBeTruthy();
  });

  it('renders both operators, sorted by name, in a table with an accessible name', async () => {
    const table = await renderPage();

    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Alpha Rails')).toBeTruthy();
    expect(within(rows[1]!).getByText('Zeta Issuer')).toBeTruthy();
  });

  it('links the operator to its site only when it has one', async () => {
    const table = await renderPage();

    const zeta = within(table).getByRole('link', { name: 'Zeta Issuer' });
    expect(zeta.getAttribute('href')).toBe('https://issuer.example');
    expect(zeta.getAttribute('rel')).toBe('noopener noreferrer');
    expect(within(table).queryByRole('link', { name: 'Alpha Rails' })).toBeNull();
  });

  it('badges each kind', async () => {
    const table = await renderPage();
    const [alpha, zeta] = within(table).getAllByRole('row').slice(1);

    expect(within(alpha!).getByText('Crypto rails')).toBeTruthy();
    expect(within(zeta!).getByText('Issuer')).toBeTruthy();
  });

  it('links every domain to its stellar.toml', async () => {
    const table = await renderPage();

    for (const domain of ['issuer.example', 'assets.issuer.example', 'rails.example']) {
      expect(within(table).getByRole('link', { name: domain }).getAttribute('href')).toBe(
        `https://${domain}/.well-known/stellar.toml`
      );
    }
  });

  it('shows the asset count, the first six codes and how many more', async () => {
    const table = await renderPage();
    const zeta = within(table).getByRole('link', { name: 'Zeta Issuer' }).closest('tr')!;

    const cell = within(zeta).getAllByRole('cell')[3]!;
    expect(cell.textContent).toBe('8 AAA, BBB, CCC, DDD, EEE, FFF +2 more');
    expect(within(zeta).getByText('+2 more')).toBeTruthy();
  });

  it('shows no "more" when six or fewer assets', async () => {
    const table = await renderPage();
    const alpha = within(table).getByText('Alpha Rails').closest('tr')!;

    expect(within(alpha).getAllByRole('cell')[3]!.textContent).toBe('1 BCH');
    expect(within(alpha).queryByText(/more/)).toBeNull();
  });

  it('describes each rail, leaving out a direction with no assets', async () => {
    const table = await renderPage();
    const alpha = within(table).getByText('Alpha Rails').closest('tr')!;

    expect(within(alpha).getByText('SEP-6 · deposit BCH, USDT · withdraw BCH, ETH')).toBeTruthy();
    expect(within(alpha).getByText('SEP-24 · withdraw BCH')).toBeTruthy();
  });

  it('shows a dash for rails on an issuer, and links the registered anchor', async () => {
    const table = await renderPage();
    const zeta = within(table).getByRole('link', { name: 'Zeta Issuer' }).closest('tr')!;
    const cells = within(zeta).getAllByRole('cell');

    expect(cells[4]!.textContent).toBe('—');
    expect(within(zeta).getByRole('link', { name: /view/ }).getAttribute('href')).toBe(
      '/anchors/cowrie'
    );
    const alpha = within(table).getByText('Alpha Rails').closest('tr')!;
    expect(within(alpha).getAllByRole('cell')[5]!.textContent).toBe('—');
  });
});

describe('listed kind filter (#1585)', () => {
  it('kind=issuer hides the crypto operator and marks the filter current', async () => {
    const table = await renderPage({ kind: 'issuer' });

    expect(within(table).getByText('Zeta Issuer')).toBeTruthy();
    expect(within(table).queryByText('Alpha Rails')).toBeNull();
    const kinds = screen.getByRole('group', { name: 'Filter listed operators by kind' });
    expect(within(kinds).getByRole('link', { name: 'Issuers' }).getAttribute('aria-current')).toBe(
      'page'
    );
    expect(
      within(kinds).getByRole('link', { name: 'All' }).getAttribute('aria-current')
    ).toBeNull();
  });

  it('kind=crypto-rails hides the issuer', async () => {
    const table = await renderPage({ kind: 'crypto-rails' });

    expect(within(table).getByText('Alpha Rails')).toBeTruthy();
    expect(within(table).queryByText('Zeta Issuer')).toBeNull();
  });

  it('treats an unknown kind as All', async () => {
    const table = await renderPage({ kind: 'bogus' });

    expect(within(table).getByText('Alpha Rails')).toBeTruthy();
    expect(within(table).getByText('Zeta Issuer')).toBeTruthy();
    const kinds = screen.getByRole('group', { name: 'Filter listed operators by kind' });
    expect(within(kinds).getByRole('link', { name: 'All' }).getAttribute('aria-current')).toBe(
      'page'
    );
  });

  it('keeps the tier in the kind links and the kind in the tier links', async () => {
    await renderPage({ tier: 'routable', kind: 'issuer' });

    const kindGroup = screen.getByRole('group', { name: 'Filter listed operators by kind' });
    expect(within(kindGroup).getByRole('link', { name: 'All' }).getAttribute('href')).toBe(
      '/anchors/directory?tier=routable'
    );
    expect(within(kindGroup).getByRole('link', { name: 'Issuers' }).getAttribute('href')).toBe(
      '/anchors/directory?tier=routable&kind=issuer'
    );
    expect(within(kindGroup).getByRole('link', { name: 'Crypto rails' }).getAttribute('href')).toBe(
      '/anchors/directory?tier=routable&kind=crypto-rails'
    );

    const tierGroup = screen.getByRole('group', { name: 'Filter anchors by tier' });
    expect(within(tierGroup).getByRole('link', { name: 'Listed' }).getAttribute('href')).toBe(
      '/anchors/directory?tier=listed&kind=issuer'
    );
    expect(within(tierGroup).getByRole('link', { name: 'All' }).getAttribute('href')).toBe(
      '/anchors/directory?kind=issuer'
    );
  });

  it('shows the empty state when the filter leaves nothing', async () => {
    render(
      await AnchorDirectoryPage({
        census: CENSUS,
        listed: [ISSUER_ENTRY],
        searchParams: { kind: 'crypto-rails' },
      })
    );

    expect(screen.getByText('No listed operators yet.')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Listed operators' })).toBeNull();
  });
});
