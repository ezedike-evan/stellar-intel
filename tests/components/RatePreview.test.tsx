import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as swr from 'swr';
import { RatePreview } from '@/components/landing/RatePreview';

vi.mock('swr');

afterEach(() => {
  vi.clearAllMocks();
});

const mockSnapshot = {
  generatedAt: new Date().toISOString(),
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
    {
      corridorId: 'usdc-kes',
      from: 'USDC',
      to: 'KES',
      countryCode: 'KE',
      countryName: 'Kenya',
      quoted: 0,
      best: null,
    },
  ],
};

const emptySnapshot = {
  generatedAt: new Date().toISOString(),
  baseAmount: '100',
  baseAsset: 'USDC',
  corridors: [
    {
      corridorId: 'usdc-ngn',
      from: 'USDC',
      to: 'NGN',
      countryCode: 'NG',
      countryName: 'Nigeria',
      quoted: 0,
      best: null,
    },
  ],
};

describe('RatePreview', () => {
  it('renders a skeleton when loading with no data', () => {
    const mockMutate = vi.fn();
    vi.mocked(swr.default).mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: mockMutate,
    } as ReturnType<typeof swr.default>);

    const { container } = render(<RatePreview />);
    const animatedDivs = container.querySelectorAll('.animate-pulse');
    expect(animatedDivs.length).toBeGreaterThan(0);
  });

  it('renders the error state with retry button', () => {
    const mockMutate = vi.fn();
    vi.mocked(swr.default).mockReturnValue({
      data: undefined,
      error: new Error('Failed to fetch'),
      isLoading: false,
      mutate: mockMutate,
    } as ReturnType<typeof swr.default>);

    render(<RatePreview />);
    expect(screen.getByText('Unable to load rate preview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('clicking retry triggers mutate', () => {
    const mockMutate = vi.fn();
    vi.mocked(swr.default).mockReturnValue({
      data: undefined,
      error: new Error('Failed to fetch'),
      isLoading: false,
      mutate: mockMutate,
    } as ReturnType<typeof swr.default>);

    render(<RatePreview />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(mockMutate).toHaveBeenCalled();
  });

  it('renders the empty state when no corridors', () => {
    const mockMutate = vi.fn();
    vi.mocked(swr.default).mockReturnValue({
      data: { ...mockSnapshot, corridors: [] },
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    } as ReturnType<typeof swr.default>);

    render(<RatePreview />);
    expect(screen.getByText(/No rate preview available right now/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument();
  });

  it('renders the empty state when no corridor has a best anchor', () => {
    const mockMutate = vi.fn();
    vi.mocked(swr.default).mockReturnValue({
      data: emptySnapshot,
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    } as ReturnType<typeof swr.default>);

    render(<RatePreview />);
    expect(screen.getByText(/No anchors are returning rates at the moment/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument();
  });

  it('renders the rate table with best anchor data', () => {
    const mockMutate = vi.fn();
    vi.mocked(swr.default).mockReturnValue({
      data: mockSnapshot,
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    } as ReturnType<typeof swr.default>);

    render(<RatePreview />);
    expect(screen.getByText('USDC/NGN')).toBeInTheDocument();
    expect(screen.getByText('Cowrie Exchange')).toBeInTheDocument();
    expect(screen.getByText(/154840 NGN/)).toBeInTheDocument();
    expect(screen.getByText(/1,580 NGN/)).toBeInTheDocument();
  });
});