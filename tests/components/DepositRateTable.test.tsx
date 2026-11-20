import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DepositRateTable } from '@/components/onramp/DepositRateTable';
import type { DepositRate, DepositRateComparison } from '@/types';

const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const CAPTION =
  'Estimates only. Each anchor sets its final rate and fees inside its deposit window.';

function rate(over: Partial<DepositRate> = {}): DepositRate {
  return {
    anchorId: 'anchor-a',
    anchorName: 'Anchor A',
    corridorId: 'usdc-ngn',
    asset: `stellar:USDC:${ISSUER}`,
    fiatAmount: 10000,
    fee: 1.5,
    feeType: 'flat',
    exchangeRate: 0.00064,
    totalReceived: 6.4,
    source: 'sep24-fee',
    updatedAt: new Date('2026-10-25T08:00:00.000Z'),
    ...over,
  };
}

function comparison(
  rows: DepositRate[],
  bestRateId = rows[0]?.anchorId ?? ''
): DepositRateComparison {
  return { corridorId: 'usdc-ngn', direction: 'deposit', rates: rows, bestRateId, errors: [] };
}

const BASE = {
  rates: comparison([rate()]),
  anchorErrors: [],
  isLoading: false,
  error: undefined,
  fiatCode: 'NGN',
  onSelectAnchor: vi.fn(),
  executeDisabled: false,
  onRefresh: vi.fn(),
};

describe('DepositRateTable (#1476)', () => {
  it('renders a row per rate with asset, estimated amount and fee', () => {
    render(<DepositRateTable {...BASE} />);

    expect(screen.getByRole('link', { name: 'Anchor A' })).toBeTruthy();
    expect(screen.getByText('USDC')).toBeTruthy();
    expect(screen.getByText('≈ 6.40 USDC')).toBeTruthy();
    expect(screen.getByText('1.5 USDC')).toBeTruthy();
    expect(screen.getByText('You receive (est.)')).toBeTruthy();
  });

  it('puts the truncated issuer in the asset title', () => {
    render(<DepositRateTable {...BASE} />);
    expect(screen.getByText('USDC').getAttribute('title')).toBe(
      `${ISSUER.slice(0, 6)}…${ISSUER.slice(-6)}`
    );
  });

  it('always shows the estimates caption, also while loading, empty and failed', () => {
    const { rerender } = render(<DepositRateTable {...BASE} />);
    expect(screen.getByText(CAPTION)).toBeTruthy();

    rerender(<DepositRateTable {...BASE} rates={undefined} isLoading />);
    expect(screen.getByText(CAPTION)).toBeTruthy();

    rerender(<DepositRateTable {...BASE} rates={comparison([])} />);
    expect(screen.getByText(CAPTION)).toBeTruthy();

    rerender(<DepositRateTable {...BASE} rates={undefined} error="boom" />);
    expect(screen.getByText(CAPTION)).toBeTruthy();
  });

  it('labels each row with the quote source pill', () => {
    render(<DepositRateTable {...BASE} />);
    expect(screen.getByText('Indicative')).toBeTruthy();
  });

  it('calls onSelectAnchor with the row when its button is clicked', () => {
    const onSelectAnchor = vi.fn();
    render(<DepositRateTable {...BASE} onSelectAnchor={onSelectAnchor} />);

    fireEvent.click(screen.getByRole('button', { name: 'Deposit with Anchor A' }));
    expect(onSelectAnchor).toHaveBeenCalledWith(BASE.rates.rates[0]);
  });

  it('disables every Deposit button when executeDisabled', () => {
    render(<DepositRateTable {...BASE} executeDisabled />);
    expect(
      (screen.getByRole('button', { name: 'Deposit with Anchor A' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('disables Deposit for a row with no estimate', () => {
    const rows = comparison([rate({ totalReceived: null, source: 'unavailable', fee: null })]);
    render(<DepositRateTable {...BASE} rates={rows} />);

    expect(screen.getByText('—', { selector: 'td.text-primary-text' })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Deposit with Anchor A' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('shows the best badge only when there are two or more rows', () => {
    const { rerender } = render(<DepositRateTable {...BASE} />);
    expect(screen.queryByText('Best estimate')).toBeNull();

    const two = comparison(
      [rate(), rate({ anchorId: 'anchor-b', anchorName: 'Anchor B', totalReceived: 6.1 })],
      'anchor-a'
    );
    rerender(<DepositRateTable {...BASE} rates={two} />);

    const badges = screen.getAllByText('Best estimate');
    expect(badges).toHaveLength(1);
    const row = badges[0]!.closest('tr')!;
    expect(within(row).getByRole('link', { name: 'Anchor A' })).toBeTruthy();
  });

  it('renders the loading skeleton instead of rows', () => {
    render(<DepositRateTable {...BASE} rates={undefined} isLoading />);

    expect(screen.getByRole('status', { name: 'Loading deposit estimates' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Deposit with/ })).toBeNull();
  });

  it('renders the empty state with the fiat code and a refresh action', () => {
    const onRefresh = vi.fn();
    render(<DepositRateTable {...BASE} rates={comparison([])} onRefresh={onRefresh} />);

    expect(
      screen.getByText('No anchor currently accepts NGN deposits on this corridor.')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders the error state with a retry action', () => {
    const onRefresh = vi.fn();
    render(
      <DepositRateTable {...BASE} rates={undefined} error="Could not fetch" onRefresh={onRefresh} />
    );

    expect(screen.getByRole('alert').textContent).toBe('Could not fetch');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('lists unavailable anchors in a collapsible section', () => {
    render(
      <DepositRateTable
        {...BASE}
        anchorErrors={[{ anchorId: 'anchor-b', anchorName: 'Anchor B', reason: 'no SEP-24' }]}
      />
    );

    const details = screen.getByText('Unavailable anchors (1)').closest('details')!;
    expect(details.open).toBe(false);
    expect(within(details).getByText('Anchor B')).toBeTruthy();
    expect(within(details).getByText('no SEP-24')).toBeTruthy();
  });

  it('does not render the unavailable section without errors', () => {
    render(<DepositRateTable {...BASE} />);
    expect(screen.queryByText(/Unavailable anchors/)).toBeNull();
  });
});

describe('DepositRateTable limits (#1477)', () => {
  const inRange = rate({ anchorId: 'in', anchorName: 'In Range', assetAmount: 100, minAmount: 5 });
  const tooSmall = rate({
    anchorId: 'small',
    anchorName: 'Too Small',
    assetAmount: 100,
    minAmount: 250,
  });
  const tooBig = rate({
    anchorId: 'big',
    anchorName: 'Too Big',
    assetAmount: 100,
    maxAmount: 50,
  });

  it('disables Deposit and shows the minimum for a row below it', () => {
    render(<DepositRateTable {...BASE} rates={comparison([tooSmall])} />);

    expect(screen.getByText('Min 250 USDC')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Deposit with Too Small' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('disables Deposit and shows the maximum for a row above it', () => {
    render(<DepositRateTable {...BASE} rates={comparison([tooBig])} />);

    expect(screen.getByText('Max 50 USDC')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Deposit with Too Big' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('leaves an in-range row enabled with no limit text', () => {
    render(<DepositRateTable {...BASE} rates={comparison([inRange])} />);

    expect(screen.queryByText(/^(Min|Max) /)).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Deposit with In Range' }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('sorts out-of-range rows last, keeping the order within each group', () => {
    const rows = comparison(
      [
        tooSmall,
        rate({ anchorId: 'in-2', anchorName: 'In Two', assetAmount: 100 }),
        tooBig,
        inRange,
      ],
      'in-2'
    );
    render(<DepositRateTable {...BASE} rates={rows} />);

    const order = screen
      .getAllByRole('button', { name: /^Deposit with/ })
      .map((b) => b.getAttribute('aria-label'));
    expect(order).toEqual([
      'Deposit with In Two',
      'Deposit with In Range',
      'Deposit with Too Small',
      'Deposit with Too Big',
    ]);
  });
});
