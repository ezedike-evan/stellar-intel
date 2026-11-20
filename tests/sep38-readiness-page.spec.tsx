import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ANCHORS } from '@/constants/anchors';
import type { Sep38Readiness } from '@/lib/stellar/sep38-readiness';

const getAllSep38Readiness = vi.hoisted(() => vi.fn());
vi.mock('@/lib/stellar/sep38-readiness', () => ({ getAllSep38Readiness }));

import Sep38ReadinessPage, { metadata, revalidate } from '@/app/anchors/sep38/page';

const [first, second, third] = ANCHORS as [
  (typeof ANCHORS)[number],
  (typeof ANCHORS)[number],
  (typeof ANCHORS)[number],
];

function row(anchorId: string, over: Partial<Sep38Readiness> = {}): Sep38Readiness {
  return {
    anchorId,
    declared: false,
    quoteServer: null,
    infoReachable: false,
    assets: [],
    sellsRegisteredAsset: false,
    error: null,
    checkedAt: '2026-10-25T08:30:45.000Z',
    ...over,
  };
}

async function renderPage() {
  render(await Sep38ReadinessPage());
}

beforeEach(() => {
  getAllSep38Readiness.mockReset();
  getAllSep38Readiness.mockResolvedValue([
    row(first.id, {
      declared: true,
      quoteServer: 'https://quotes.example',
      infoReachable: true,
      sellsRegisteredAsset: true,
      assets: ['stellar:USDC:GISSUER', 'iso4217:NGN'],
    }),
    row(second.id, { declared: true, error: 'stellar.toml: not found' }),
    row(third.id),
  ]);
});

function rowOf(name: string): HTMLElement {
  return screen.getByRole('link', { name }).closest('tr')!;
}

describe('/anchors/sep38 (#1506)', () => {
  it('sets its metadata and revalidation', () => {
    expect(metadata.title).toBe('SEP-38 firm-quote readiness — Stellar Intel');
    expect(revalidate).toBe(600);
  });

  it('explains firm and indicative quotes and links the methodology', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'SEP-38 firm-quote readiness'
    );
    expect(screen.getByText(/firm quote \(SEP-38\)/i)).toBeTruthy();
    expect(screen.getByText(/indicative quote/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /How we measure/ }).getAttribute('href')).toBe(
      '/methodology'
    );
  });

  it('renders one row per anchor, each linking to its profile', async () => {
    await renderPage();

    for (const anchor of [first, second, third]) {
      expect(screen.getByRole('link', { name: anchor.name }).getAttribute('href')).toBe(
        `/anchors/${anchor.id}`
      );
    }
  });

  it('shows yes and no as words in the right columns', async () => {
    await renderPage();

    const cells = within(rowOf(first.name)).getAllByRole('cell');
    // anchor, declares, quote server, /info, sells asset, assets, checked at
    expect(cells.slice(1, 5).map((c) => c.textContent)).toEqual(['yes', 'yes', 'yes', 'yes']);

    const noneCells = within(rowOf(third.name)).getAllByRole('cell');
    expect(noneCells.slice(1, 5).map((c) => c.textContent)).toEqual(['no', 'no', 'no', 'no']);
  });

  it('keeps the declared-but-not-advertised mismatch visible', async () => {
    await renderPage();

    const cells = within(rowOf(second.name)).getAllByRole('cell');
    expect(cells[1]!.textContent).toBe('yes'); // declares SEP-38
    expect(cells[2]!.textContent).toBe('no'); // but advertises no quote server
  });

  it('lists the assets behind a count, in a details element', async () => {
    await renderPage();

    const cell = within(rowOf(first.name)).getAllByRole('cell')[5]!;
    const details = cell.querySelector('details')!;
    expect(details.querySelector('summary')!.textContent).toBe('2');
    expect([...details.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'stellar:USDC:GISSUER',
      'iso4217:NGN',
    ]);
    expect(within(rowOf(third.name)).getAllByRole('cell')[5]!.textContent).toBe('0');
  });

  it('shows the reason a check failed and when it ran', async () => {
    await renderPage();

    expect(within(rowOf(second.name)).getByText('stellar.toml: not found')).toBeTruthy();
    expect(within(rowOf(first.name)).getByText('2026-10-25 08:30 UTC')).toBeTruthy();
  });

  it('summarises how many are ready for firm quotes', async () => {
    await renderPage();
    expect(screen.getByText('1 of 3 ready for firm quotes')).toBeTruthy();
  });
});

describe('route precedence (#1506)', () => {
  it('has a static page, so [id] cannot capture /anchors/sep38', () => {
    expect(existsSync(join(process.cwd(), 'app/anchors/sep38/page.tsx'))).toBe(true);
  });

  it('is not an anchor id that would collide with the static segment', () => {
    expect(ANCHORS.map((a) => a.id)).not.toContain('sep38');
  });
});
