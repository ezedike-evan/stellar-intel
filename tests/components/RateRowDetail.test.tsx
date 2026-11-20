import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RateRowDetail } from '@/components/offramp/RateRowDetail';
import type { AnchorRate } from '@/types';

function rate(over: Partial<AnchorRate> = {}): AnchorRate {
  return {
    anchorId: 'cowrie',
    anchorName: 'Cowrie',
    corridorId: 'usdc-ngn',
    fee: 2,
    feeType: 'flat',
    exchangeRate: 1550,
    totalReceived: 152_000,
    source: 'sep24-fee',
    updatedAt: new Date('2026-10-25T08:00:00.000Z'),
    ...over,
  };
}

function renderDetail(r: AnchorRate) {
  return render(
    <table>
      <tbody>
        <RateRowDetail rate={r} currency="NGN" colSpan={6} />
      </tbody>
    </table>
  );
}

const HEADING = 'How this estimate is built';
const DISCLAIMER = 'Estimate only. The anchor confirms the final rate before you pay.';

describe('RateRowDetail estimate recipe (#1515)', () => {
  it('names the reference price behind an indicative estimate', () => {
    renderDetail(rate({ referenceDetail: 'SDEX USDC/XLM mid + ECB XLM/NGN' }));

    expect(screen.getByText(HEADING)).toBeTruthy();
    expect(
      screen
        .getByText(/Anchor fee from its published schedule \+ reference price/)
        .textContent!.replace(/\s+/g, ' ')
        .trim()
    ).toBe(
      'Anchor fee from its published schedule + reference price (SDEX USDC/XLM mid + ECB XLM/NGN)'
    );
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
  });

  it('says just "reference price" when there is no detail', () => {
    renderDetail(rate());

    const text = screen.getByText(/Anchor fee from its published schedule/).textContent!;
    expect(text.replace(/\s+/g, ' ').trim()).toBe(
      'Anchor fee from its published schedule + reference price'
    );
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
  });

  it.each(['sep6-info', 'sep6-fee'] as const)('also explains a %s estimate', (source) => {
    renderDetail(rate({ source }));
    expect(screen.getByText(HEADING)).toBeTruthy();
  });

  it('shows no recipe for a firm sep38 quote', () => {
    renderDetail(rate({ source: 'sep38', referenceDetail: 'anything' }));

    expect(screen.queryByText(HEADING)).toBeNull();
    expect(screen.queryByText(DISCLAIMER)).toBeNull();
    expect(screen.getByText('Firm quote (SEP-38)')).toBeTruthy();
  });

  it('shows no recipe for an unavailable row', () => {
    renderDetail(rate({ source: 'unavailable' }));
    expect(screen.queryByText(HEADING)).toBeNull();
  });

  it('keeps the existing rows', () => {
    renderDetail(rate());
    expect(screen.getByText('Fee')).toBeTruthy();
    expect(screen.getByText('Quote type')).toBeTruthy();
    expect(screen.getByText('Indicative (SEP-24)')).toBeTruthy();
  });
});
