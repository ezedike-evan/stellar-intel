import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import * as swr from 'swr';
import { RatePreview } from '@/components/landing/RatePreview';

vi.mock('swr');

afterEach(() => {
  vi.clearAllMocks();
});

// Fixed timestamp — not `new Date()` — so the snapshot is stable across runs.
const FIXED_GENERATED_AT = '2026-06-01T00:00:00.000Z';

describe('RatePreview', () => {
  it('matches the visual snapshot with live snapshot data', () => {
    vi.mocked(swr.default).mockReturnValue({
      data: {
        generatedAt: FIXED_GENERATED_AT,
        baseAmount: '100',
        baseAsset: 'USDC',
        corridors: [
          {
            corridorId: 'usdc-ngn',
            from: 'USDC',
            to: 'NGN',
            countryCode: 'NG',
            countryName: 'Nigeria',
            quoted: 2,
            best: {
              anchorId: 'cowrie',
              anchorName: 'Cowrie Exchange',
              totalReceived: 154840,
              exchangeRate: 1580,
              source: 'sep24-fee' as const,
            },
          },
        ],
      },
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof swr.default>);

    const { container } = render(<RatePreview />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('matches the visual snapshot in the loading state', () => {
    vi.mocked(swr.default).mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      isValidating: true,
      mutate: vi.fn(),
    } as ReturnType<typeof swr.default>);

    const { container } = render(<RatePreview />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
