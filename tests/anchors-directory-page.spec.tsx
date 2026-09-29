import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AnchorDirectoryPage, { metadata } from '@/app/anchors/directory/page';
import type { AnchorCensus } from '@/types';

afterEach(() => cleanup());


const MOCK_CENSUS: AnchorCensus = {
  generatedAt: '2026-09-27T12:00:00.000Z',
  sources: ['stellar.expert', 'anchors.ts'],
  counts: {
    routable: 1,
    healthOnly: 1,
    listed: 1,
    excluded: 0,
  },
  rows: [
    {
      domain: 'anclap.com',
      tier: 'routable',
      seps: {
        sep6: true,
        sep24: true,
        sep31: false,
        sep38: true,
        sep10: true,
      },
      withdrawAssets: ['ARS', 'USD'],
      depositAssets: ['ARS'],
      receiveAssets: [],
      sources: ['stellar.expert', 'anchors.ts'],
      registeredAnchorId: 'anclap',
      checkedAt: '2026-09-27T12:00:00.000Z',
    },
    {
      domain: 'mykobo.co',
      tier: 'health-only',
      seps: {
        sep6: false,
        sep24: true,
        sep31: true,
        sep38: false,
        sep10: true,
      },
      withdrawAssets: [],
      depositAssets: ['EUR'],
      receiveAssets: ['EUR'],
      sources: ['stellar.expert'],
      registeredAnchorId: null,
      checkedAt: '2026-09-27T12:00:00.000Z',
    },
    {
      domain: 'example-issuer.org',
      tier: 'listed',
      seps: {
        sep6: false,
        sep24: false,
        sep31: false,
        sep38: false,
        sep10: false,
      },
      withdrawAssets: [],
      depositAssets: [],
      receiveAssets: [],
      sources: ['stellar.expert'],
      registeredAnchorId: null,
      checkedAt: '2026-09-27T12:00:00.000Z',
    },
  ],
};

describe('Anchor directory page (ANC057)', () => {
  it('exports valid metadata with title and description', () => {
    expect(metadata.title).toBe('Anchor directory');
    expect(typeof metadata.description).toBe('string');
  });

  it('renders rows from a mocked census', async () => {
    const jsx = await AnchorDirectoryPage({ census: MOCK_CENSUS });
    render(jsx);

    expect(screen.getByRole('heading', { level: 1, name: 'Anchor directory' })).toBeTruthy();
    expect(screen.getByText('2026-09-27T12:00:00.000Z')).toBeTruthy();

    // Check domains and links to stellar.toml
    const anclapLink = screen.getByRole('link', { name: 'anclap.com' });
    expect(anclapLink.getAttribute('href')).toBe('https://anclap.com/.well-known/stellar.toml');
    expect(anclapLink.getAttribute('rel')).toBe('noopener noreferrer');

    const mykoboLink = screen.getByRole('link', { name: 'mykobo.co' });
    expect(mykoboLink.getAttribute('href')).toBe('https://mykobo.co/.well-known/stellar.toml');

    const exampleLink = screen.getByRole('link', { name: 'example-issuer.org' });
    expect(exampleLink.getAttribute('href')).toBe('https://example-issuer.org/.well-known/stellar.toml');

    // Check tier labels
    expect(screen.getByText('routable')).toBeTruthy();
    expect(screen.getByText('health-only')).toBeTruthy();
    expect(screen.getByText('listed')).toBeTruthy();

    // Check assets and sources
    expect(screen.getByText('ARS, USD')).toBeTruthy();
    expect(screen.getByText('EUR')).toBeTruthy();
    expect(screen.getByText('stellar.expert, anchors.ts')).toBeTruthy();
  });

  it('tier filter narrows rows to routable and marks filter aria-current', async () => {
    const jsx = await AnchorDirectoryPage({
      census: MOCK_CENSUS,
      searchParams: Promise.resolve({ tier: 'routable' }),
    });
    render(jsx);

    expect(screen.getByRole('link', { name: 'anclap.com' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'mykobo.co' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'example-issuer.org' })).toBeNull();

    const routableFilterLink = screen.getByRole('link', { name: 'Routable' });
    expect(routableFilterLink.getAttribute('aria-current')).toBe('page');
  });

  it('tier filter narrows rows to health-only and marks filter aria-current', async () => {
    const jsx = await AnchorDirectoryPage({
      census: MOCK_CENSUS,
      searchParams: { tier: 'health-only' },
    });
    render(jsx);

    expect(screen.queryByRole('link', { name: 'anclap.com' })).toBeNull();
    expect(screen.getByRole('link', { name: 'mykobo.co' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'example-issuer.org' })).toBeNull();

    const healthOnlyFilterLink = screen.getByRole('link', { name: 'Health-only' });
    expect(healthOnlyFilterLink.getAttribute('aria-current')).toBe('page');
  });

  it('shows empty state when rows is empty', async () => {
    const emptyCensus: AnchorCensus = {
      generatedAt: null,
      sources: [],
      counts: { routable: 0, healthOnly: 0, listed: 0, excluded: 0 },
      rows: [],
    };

    const jsx = await AnchorDirectoryPage({ census: emptyCensus });
    render(jsx);

    expect(screen.getByText('The census has not been generated yet.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('registered rows link to /anchors/<id>', async () => {
    const jsx = await AnchorDirectoryPage({ census: MOCK_CENSUS });
    render(jsx);

    const registeredLink = screen.getByRole('link', { name: /view/i });
    expect(registeredLink.getAttribute('href')).toBe('/anchors/anclap');
  });

  it('table has a caption or aria-label', async () => {
    const jsx = await AnchorDirectoryPage({ census: MOCK_CENSUS });
    render(jsx);

    const table = screen.getByRole('table', { name: /anchor directory/i });
    expect(table).toBeTruthy();
    expect(
      table.getAttribute('aria-label') === 'Anchor directory' ||
        table.querySelector('caption')?.textContent === 'Anchor directory'
    ).toBe(true);
  });
});
