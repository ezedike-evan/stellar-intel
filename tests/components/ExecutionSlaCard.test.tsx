import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExecutionSlaCard } from '@/components/anchors/ExecutionSlaCard';
import { flags } from '@/lib/flags';
import type { ExecutionSla, ExecutionSlaReport } from '@/lib/reputation/execution-sla';

const NOW = '2026-11-01T00:00:00.000Z';
const base = {
  windowDays: 30,
  windowStart: '2026-10-02T00:00:00.000Z',
  windowEnd: NOW,
  terminalCount: 140,
  minSamples: 30,
  computedAt: NOW,
};

function ok(p50Ms: number, p95Ms: number, p99Ms: number | null, sampleSize = 120): ExecutionSla {
  return { ...base, state: 'ok', sampleSize, p50Ms, p95Ms, p99Ms };
}

function insufficient(sampleSize: number): ExecutionSla {
  return { ...base, state: 'insufficient_data', sampleSize };
}

function report(overrides: Partial<ExecutionSlaReport> = {}): ExecutionSlaReport {
  const sla = ok(42_400, 245_000, 3_600_000);
  return {
    anchorId: 'moneygram',
    windowDays: 30,
    computedAt: NOW,
    thresholds: { p95Ms: 15 * 60 * 1000, p99Ms: 60 * 60 * 1000 },
    overall: { sla, breach: { status: 'within', breaches: [] } },
    corridors: [{ corridor: 'usdc-ngn', sla, breach: { status: 'within', breaches: [] } }],
    history: [],
    ...overrides,
  };
}

describe('ExecutionSlaCard (#2146)', () => {
  it('is a labelled region', () => {
    render(<ExecutionSlaCard report={report()} />);
    expect(screen.getByRole('region', { name: 'Settlement time' })).toBeInTheDocument();
  });

  it('shows the three formatted percentiles for an ok report', () => {
    render(<ExecutionSlaCard report={report()} />);
    expect(screen.getByText('42s')).toBeInTheDocument();
    expect(screen.getByText('4m 05s')).toBeInTheDocument();
    expect(screen.getByText('1h 00m')).toBeInTheDocument();
  });

  it('asks for 100+ settlements when p99 is not reported', () => {
    const sla = ok(42_400, 245_000, null);
    render(
      <ExecutionSlaCard
        report={report({ overall: { sla, breach: { status: 'within', breaches: [] } } })}
      />
    );
    expect(screen.getByText('Needs 100+ settlements')).toBeInTheDocument();
  });

  it('states a within-target result in words', () => {
    render(<ExecutionSlaCard report={report()} />);
    expect(screen.getByText('Within target: 95% under 15m 00s')).toBeInTheDocument();
  });

  it('states each breach in words', () => {
    const sla = ok(60_000, 20 * 60_000, 2 * 3_600_000);
    render(
      <ExecutionSlaCard
        report={report({
          overall: {
            sla,
            breach: {
              status: 'breach',
              breaches: [
                { metric: 'p95', observedMs: 20 * 60_000, thresholdMs: 15 * 60_000 },
                { metric: 'p99', observedMs: 2 * 3_600_000, thresholdMs: 3_600_000 },
              ],
            },
          },
        })}
      />
    );
    expect(screen.getByText('Slower than target: p95 20m 00s vs 15m 00s')).toBeInTheDocument();
    expect(screen.getByText('Slower than target: p99 2h 00m vs 1h 00m')).toBeInTheDocument();
    expect(screen.queryByText(/Within target/)).not.toBeInTheDocument();
  });

  it('shows neither breach nor within text for an unknown assessment', () => {
    const sla = ok(42_400, 245_000, 3_600_000);
    render(
      <ExecutionSlaCard
        report={report({ overall: { sla, breach: { status: 'unknown', breaches: [] } } })}
      />
    );
    expect(screen.queryByText(/Within target/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Slower than target/)).not.toBeInTheDocument();
  });

  it('explains insufficient data with the sample count', () => {
    const sla = insufficient(12);
    render(
      <ExecutionSlaCard
        report={report({
          overall: { sla, breach: { status: 'unknown', breaches: [] } },
          corridors: [],
        })}
      />
    );
    expect(screen.getByText(/\(12 of 30 needed\)/)).toBeInTheDocument();
  });

  it('renders the corridor table only with more than one corridor', () => {
    const { unmount } = render(<ExecutionSlaCard report={report()} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    unmount();

    const sla = ok(42_400, 245_000, 3_600_000);
    render(
      <ExecutionSlaCard
        report={report({
          corridors: [
            { corridor: 'usdc-ngn', sla, breach: { status: 'within', breaches: [] } },
            {
              corridor: 'usdc-kes',
              sla: insufficient(4),
              breach: { status: 'unknown', breaches: [] },
            },
          ],
        })}
      />
    );
    expect(screen.getByRole('table', { name: 'Settlement time by corridor' })).toBeInTheDocument();
    for (const header of ['Corridor', 'p50', 'p95', 'p99', 'Samples']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(screen.getByText('USDC → KES')).toBeInTheDocument();
  });

  it('is behind a flag that is off by default', () => {
    expect(flags.executionSla).toBe(false);
  });

  describe('daily p95 trend (#2147)', () => {
    const day = (n: number, p95Ms: number | null) => ({
      day: `2026-10-${String(n).padStart(2, '0')}`,
      p95Ms,
      sampleSize: p95Ms === null ? 2 : 10,
    });

    it('draws the sparkline with a caption when 3 days have a p95', () => {
      render(
        <ExecutionSlaCard
          report={report({
            history: [day(1, 80_000), day(2, null), day(3, 90_000), day(4, 100_000)],
          })}
        />
      );
      expect(screen.getByTestId('sparkline-svg')).toBeInTheDocument();
      expect(
        screen.getByText(/Daily 95th-percentile settle time, 2026-10-01 to 2026-10-04/)
      ).toHaveTextContent('(3 days with enough data)');
    });

    it('falls back to text with only one day of data', () => {
      render(<ExecutionSlaCard report={report({ history: [day(1, 80_000), day(2, null)] })} />);
      expect(screen.queryByTestId('sparkline-svg')).not.toBeInTheDocument();
      expect(screen.getByText('Not enough daily data for a trend yet.')).toBeInTheDocument();
    });

    it('falls back to text when every day is null', () => {
      render(<ExecutionSlaCard report={report({ history: [day(1, null), day(2, null)] })} />);
      expect(screen.queryByTestId('sparkline-svg')).not.toBeInTheDocument();
      expect(screen.getByText('Not enough daily data for a trend yet.')).toBeInTheDocument();
    });

    it('shows the trend even when the 30-day total is insufficient', () => {
      const sla = insufficient(12);
      render(
        <ExecutionSlaCard
          report={report({
            overall: { sla, breach: { status: 'unknown', breaches: [] } },
            corridors: [],
            history: [day(1, 80_000), day(2, 90_000)],
          })}
        />
      );
      expect(screen.getByTestId('sparkline-svg')).toBeInTheDocument();
    });
  });
});
