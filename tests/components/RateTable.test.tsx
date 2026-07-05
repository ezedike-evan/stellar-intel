import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RateTable } from '@/components/offramp/RateTable';
import type { RateComparison, AnchorRate } from '@/types';

const makeRate = (anchorId: string, totalReceived: number): AnchorRate => ({
  anchorId,
  anchorName: anchorId === 'cowrie' ? 'Cowrie' : 'Flutterwave',
  corridorId: 'usdc-ngn',
  fee: 2,
  feeType: 'flat',
  exchangeRate: 1580,
  totalReceived,
  source: 'sep24-fee' as const,
  updatedAt: new Date(),
});

const mockRates: RateComparison = {
  corridorId: 'usdc-ngn',
  bestRateId: 'cowrie',
  pending: [],
  rates: [makeRate('cowrie', 154840), makeRate('flutterwave', 153260)],
};

describe('RateTable', () => {
  it('renders a skeleton rows when isLoading is true', () => {
    const { container } = render(
      <RateTable rates={undefined} isLoading={true} error={undefined} onSelectAnchor={() => {}} />
    );
    const animatedDivs = container.querySelectorAll('.animate-pulse');
    expect(animatedDivs.length).toBeGreaterThan(0);
  });

  it('renders the correct number of data rows from a RateComparison with two anchors', () => {
    render(
      <RateTable rates={mockRates} isLoading={false} error={undefined} onSelectAnchor={vi.fn()} />
    );
    const buttons = screen.getAllByRole('button', { name: 'Off-ramp' });
    expect(buttons).toHaveLength(2);
  });

  it('the best rate row includes the "Best Rate" badge', () => {
    render(
      <RateTable rates={mockRates} isLoading={false} error={undefined} onSelectAnchor={vi.fn()} />
    );
    expect(screen.getByText('Best Rate')).toBeInTheDocument();
  });

  it('the error state renders the error message string', () => {
    render(
      <RateTable
        rates={undefined}
        isLoading={false}
        error="Failed to fetch rates"
        onSelectAnchor={vi.fn()}
      />
    );
    expect(screen.getByText('Failed to fetch rates')).toBeInTheDocument();
  });

  it('clicking the "Off-ramp" button calls onSelectAnchor with the correct AnchorRate', () => {
    const onSelectAnchor = vi.fn();
    render(
      <RateTable
        rates={mockRates}
        isLoading={false}
        error={undefined}
        onSelectAnchor={onSelectAnchor}
      />
    );
    const buttons = screen.getAllByRole('button', { name: 'Off-ramp' });
    fireEvent.click(buttons[0] as HTMLElement);
    expect(onSelectAnchor).toHaveBeenCalledWith(mockRates.rates[0]);
  });

  it('renders the empty state message when rates array is empty', () => {
    const emptyRates: RateComparison = { ...mockRates, rates: [], bestRateId: '' };
    render(
      <RateTable rates={emptyRates} isLoading={false} error={undefined} onSelectAnchor={vi.fn()} />
    );
    expect(screen.getByText('No rates available for this corridor.')).toBeInTheDocument();
  });

  it('renders an unavailable row for each anchorError', () => {
    render(
      <RateTable
        rates={mockRates}
        anchorErrors={[
          { anchorId: 'bitso', anchorName: 'Bitso', reason: 'SEP-38 timed out after 8000ms' },
        ]}
        isLoading={false}
        error={undefined}
        onSelectAnchor={vi.fn()}
      />
    );
    expect(screen.getByText('Bitso')).toBeInTheDocument();
    const unavailableBtn = screen.getByRole('button', { name: /unavailable/i });
    expect(unavailableBtn).toBeDisabled();
  });

  it('unavailable row button has the error reason as its title attribute', () => {
    render(
      <RateTable
        rates={mockRates}
        anchorErrors={[
          { anchorId: 'bitso', anchorName: 'Bitso', reason: 'SEP-38 timed out after 8000ms' },
        ]}
        isLoading={false}
        error={undefined}
        onSelectAnchor={vi.fn()}
      />
    );
    const unavailableBtn = screen.getByRole('button', { name: /unavailable/i });
    expect(unavailableBtn).toHaveAttribute('title', 'SEP-38 timed out after 8000ms');
  });

  it('does not show empty state when there are no rates but there are anchorErrors', () => {
    const emptyRates: RateComparison = { ...mockRates, rates: [], bestRateId: '' };
    render(
      <RateTable
        rates={emptyRates}
        anchorErrors={[
          { anchorId: 'bitso', anchorName: 'Bitso', reason: 'SEP-38 timed out after 8000ms' },
        ]}
        isLoading={false}
        error={undefined}
        onSelectAnchor={vi.fn()}
      />
    );
    expect(screen.queryByText('No rates available for this corridor.')).not.toBeInTheDocument();
    expect(screen.getByText('Bitso')).toBeInTheDocument();
  });

  it('renders "Indicative (SEP-6)" badge for sep6-info rows', () => {
    const sep6Rate: AnchorRate = {
      ...makeRate('yellowcard', 152000),
      anchorName: 'Yellow Card',
      source: 'sep6-info' as const,
    };
    const sep38Rate: AnchorRate = {
      ...makeRate('cowrie', 154840),
      source: 'sep38' as const,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const mixedRates: RateComparison = {
      corridorId: 'usdc-ngn',
      bestRateId: 'cowrie',
      pending: [],
      rates: [sep6Rate, sep38Rate],
    };
    render(
      <RateTable rates={mixedRates} isLoading={false} error={undefined} onSelectAnchor={vi.fn()} />
    );
    expect(screen.getByText('Indicative (SEP-6)')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toBeInTheDocument();
  });
});
