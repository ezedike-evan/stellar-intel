import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExecutionSlaCard } from '@/components/anchors/ExecutionSlaCard';
import type { ExecutionSlaReport } from '@/lib/reputation/execution-sla';

function makeReport(overrides?: Partial<ExecutionSlaReport>): ExecutionSlaReport {
  return {
    anchorId: 'moneygram',
    windowDays: 30,
    computedAt: '2026-06-04T12:00:00.000Z',
    thresholds: { p95Ms: 900_000, p99Ms: 3_600_000 },
    overall: {
      sla: {
        state: 'ok',
        anchorId: 'moneygram',
        corridor: null,
        windowDays: 30,
        computedAt: '2026-06-04T12:00:00.000Z',
        sampleSize: 50,
        terminalTxCount: 50,
        p50Ms: 60_000,
        p95Ms: 120_000,
        p99Ms: null,
      },
      breach: { status: 'within', breaches: [] },
    },
    corridors: [],
    history: Array.from({ length: 30 }, (_, i) => ({
      day: `2026-05-${String(i + 1).padStart(2, '0')}`,
      p95Ms: null,
      sampleSize: 0,
    })),
    ...overrides,
  };
}

describe('ExecutionSlaCard (#2147)', () => {
  it('renders sparkline-svg and caption when history has 3 non-null days', () => {
    const report = makeReport();
    report.history[0] = { day: '2026-05-01', p95Ms: 80_000, sampleSize: 10 };
    report.history[1] = { day: '2026-05-02', p95Ms: 90_000, sampleSize: 12 };
    report.history[2] = { day: '2026-05-03', p95Ms: 100_000, sampleSize: 8 };

    render(<ExecutionSlaCard report={report} />);

    expect(screen.getByTestId('sparkline-svg')).toBeTruthy();
    expect(
      screen.getByText(/Daily 95th-percentile settle time, 2026-05-01 to 2026-05-03 \(3 days with enough data\)/)
    ).toBeTruthy();
  });

  it('renders fallback text and no sparkline-svg when history has only 1 non-null day', () => {
    const report = makeReport();
    report.history[0] = { day: '2026-05-01', p95Ms: 80_000, sampleSize: 10 };

    render(<ExecutionSlaCard report={report} />);

    expect(screen.queryByTestId('sparkline-svg')).toBeNull();
    expect(screen.getByText('Not enough daily data for a trend yet.')).toBeTruthy();
  });

  it('renders fallback text when history has all-null points', () => {
    const report = makeReport();

    render(<ExecutionSlaCard report={report} />);

    expect(screen.queryByTestId('sparkline-svg')).toBeNull();
    expect(screen.getByText('Not enough daily data for a trend yet.')).toBeTruthy();
  });

  it('renders p50, p95, p99 and within target badge for ok overall state', () => {
    const report = makeReport();
    render(<ExecutionSlaCard report={report} />);

    expect(screen.getByTestId('execution-sla-card')).toBeTruthy();
    expect(screen.getByText('1m 00s')).toBeTruthy(); // p50 = 60s
    expect(screen.getByText('2m 00s')).toBeTruthy(); // p95 = 120s
    expect(screen.getByText('Needs 100+ settlements')).toBeTruthy(); // p99Ms null
    expect(screen.getByText('Within target')).toBeTruthy();
  });

  it('renders insufficient data message when overall state is insufficient_data', () => {
    const report = makeReport({
      overall: {
        sla: {
          state: 'insufficient_data',
          anchorId: 'moneygram',
          corridor: null,
          windowDays: 30,
          computedAt: '2026-06-04T12:00:00.000Z',
          sampleSize: 15,
          terminalTxCount: 15,
          p50Ms: null,
          p95Ms: null,
          p99Ms: null,
        },
        breach: { status: 'unknown', breaches: [] },
      },
    });

    render(<ExecutionSlaCard report={report} />);
    expect(
      screen.getByText(/Not enough completed withdrawals yet to calculate settlement percentiles/)
    ).toBeTruthy();
  });
});
