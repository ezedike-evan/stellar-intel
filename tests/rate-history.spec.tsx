import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { RateTable } from '@/components/offramp/RateTable';
import { useRateHistory, describeRateTrend, RATE_HISTORY_LENGTH } from '@/hooks/useRateHistory';
import type { AnchorRate, RateComparison } from '@/types';

function rate(anchorId: string, exchangeRate: number | null, corridorId = 'usdc-ngn'): AnchorRate {
  return {
    anchorId,
    anchorName: anchorId,
    corridorId,
    fee: 1,
    feeType: 'flat',
    exchangeRate,
    totalReceived: exchangeRate === null ? null : exchangeRate * 100,
    updatedAt: new Date(),
    source: 'sep38',
  };
}

function comparison(rates: AnchorRate[], corridorId = 'usdc-ngn'): RateComparison {
  return { corridorId, bestRateId: rates[0]?.anchorId ?? '', pending: [], rates };
}

describe('useRateHistory', () => {
  it('appends one point per new rates object', () => {
    const { result, rerender } = renderHook(({ r }) => useRateHistory(r), {
      initialProps: { r: comparison([rate('cowrie', 1500)]) },
    });

    expect(result.current['usdc-ngn:cowrie']).toEqual([1500]);

    rerender({ r: comparison([rate('cowrie', 1510)]) });
    rerender({ r: comparison([rate('cowrie', 1520)]) });

    expect(result.current['usdc-ngn:cowrie']).toEqual([1500, 1510, 1520]);
  });

  it('does not append when the same rates object is re-rendered', () => {
    // The parent re-rendering for an unrelated reason must not add a point, or
    // the chart becomes a picture of React's scheduling rather than of rates.
    const same = comparison([rate('cowrie', 1500)]);
    const { result, rerender } = renderHook(({ r }) => useRateHistory(r), {
      initialProps: { r: same },
    });

    rerender({ r: same });
    rerender({ r: same });

    expect(result.current['usdc-ngn:cowrie']).toEqual([1500]);
  });

  it('caps the series and keeps the most recent points', () => {
    const { result, rerender } = renderHook(({ r }) => useRateHistory(r), {
      initialProps: { r: comparison([rate('cowrie', 0)]) },
    });

    for (let i = 1; i <= RATE_HISTORY_LENGTH + 3; i++) {
      rerender({ r: comparison([rate('cowrie', i)]) });
    }

    const series = result.current['usdc-ngn:cowrie']!;
    expect(series).toHaveLength(RATE_HISTORY_LENGTH);
    expect(series[series.length - 1]).toBe(RATE_HISTORY_LENGTH + 3);
    // Oldest points dropped, not newest.
    expect(series[0]).toBe(4);
  });

  it('never records a null or non-positive rate as a value', () => {
    const { result, rerender } = renderHook(({ r }) => useRateHistory(r), {
      initialProps: { r: comparison([rate('cowrie', 1500)]) },
    });

    rerender({ r: comparison([rate('cowrie', null)]) });
    rerender({ r: comparison([rate('cowrie', 0)]) });

    // An absent observation is absent — not a zero that would crater the chart.
    expect(result.current['usdc-ngn:cowrie'] ?? []).not.toContain(0);
  });

  it('keys by corridor so switching corridors cannot mix series', () => {
    const { result, rerender } = renderHook(({ r }) => useRateHistory(r), {
      initialProps: { r: comparison([rate('cowrie', 1500)]) },
    });

    rerender({ r: comparison([rate('cowrie', 18, 'usdc-zar')], 'usdc-zar') });

    expect(result.current['usdc-zar:cowrie']).toEqual([18]);
    // The NGN series is dropped rather than continuing to accumulate.
    expect(result.current['usdc-ngn:cowrie']).toBeUndefined();
  });

  it('tracks each anchor separately', () => {
    const { result, rerender } = renderHook(({ r }) => useRateHistory(r), {
      initialProps: { r: comparison([rate('cowrie', 1500), rate('ngnc', 1490)]) },
    });

    rerender({ r: comparison([rate('cowrie', 1505), rate('ngnc', 1480)]) });

    expect(result.current['usdc-ngn:cowrie']).toEqual([1500, 1505]);
    expect(result.current['usdc-ngn:ngnc']).toEqual([1490, 1480]);
  });

  it('tolerates undefined rates', () => {
    const { result } = renderHook(() => useRateHistory(undefined));
    expect(result.current).toEqual({});
  });
});

describe('describeRateTrend', () => {
  it('returns null below two points, so nothing empty is announced', () => {
    expect(describeRateTrend(undefined)).toBeNull();
    expect(describeRateTrend([])).toBeNull();
    expect(describeRateTrend([1500])).toBeNull();
  });

  it('names the direction and magnitude', () => {
    expect(describeRateTrend([1000, 1100])).toBe(
      'Rate trending up 10.0% over the last 2 refreshes'
    );
    expect(describeRateTrend([1000, 900])).toBe(
      'Rate trending down 10.0% over the last 2 refreshes'
    );
  });

  it('says unchanged rather than "up 0.0%"', () => {
    expect(describeRateTrend([1500, 1500, 1500])).toBe('Rate unchanged over the last 3 refreshes');
  });

  it('avoids printing a percentage that rounds to nothing', () => {
    // 0.02% would render as "up 0.0%", which reads as a bug.
    expect(describeRateTrend([10000, 10002])).toBe(
      'Rate trending up slightly over the last 2 refreshes'
    );
  });
});

describe('RateTable sparkline row', () => {
  it('reserves the sparkline height before any history exists', () => {
    // The wrapper must be present from the first paint, or rows jump when the
    // second data point lands a refresh later.
    render(
      <RateTable
        rates={comparison([rate('cowrie', 1500)])}
        isLoading={false}
        error={undefined}
        onSelectAnchor={vi.fn()}
      />
    );

    const slot = screen.getByTestId('rate-sparkline-cowrie');
    expect(slot).toBeInTheDocument();
    expect(slot.className).toContain('h-4');
    expect(screen.queryByTestId('sparkline-svg')).not.toBeInTheDocument();
  });

  it('renders the chart and its text alternative once two points exist', () => {
    const first = comparison([rate('cowrie', 1500)]);
    const { rerender } = render(
      <RateTable rates={first} isLoading={false} error={undefined} onSelectAnchor={vi.fn()} />
    );

    act(() => {
      rerender(
        <RateTable
          rates={comparison([rate('cowrie', 1650)])}
          isLoading={false}
          error={undefined}
          onSelectAnchor={vi.fn()}
        />
      );
    });

    expect(screen.getByTestId('sparkline-svg')).toBeInTheDocument();
    // aria-hidden on the chart, so the description is the accessible content.
    expect(screen.getByTestId('sparkline-svg')).toHaveAttribute('aria-hidden', 'true');
    expect(
      screen.getByText(/Rate trending up 10\.0% over the last 2 refreshes/)
    ).toBeInTheDocument();
  });

  it('shows no chart for an anchor that never quoted', () => {
    render(
      <RateTable
        rates={comparison([rate('cowrie', null)])}
        isLoading={false}
        error={undefined}
        onSelectAnchor={vi.fn()}
      />
    );

    expect(screen.getByTestId('rate-sparkline-cowrie')).toBeEmptyDOMElement();
  });
});
