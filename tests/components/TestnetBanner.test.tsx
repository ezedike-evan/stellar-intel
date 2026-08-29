import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// STELLAR_NETWORK is resolved once at module load (constants/index.ts ->
// lib/env.ts), so each case resets the module registry and re-imports with
// a different process.env value. Scoped to this file's isolated worker.
const ORIGINAL_NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env.NEXT_PUBLIC_STELLAR_NETWORK = ORIGINAL_NETWORK;
});

describe('TestnetBanner', () => {
  it('renders the warning banner when NEXT_PUBLIC_STELLAR_NETWORK is testnet', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'testnet';
    const { TestnetBanner } = await import('@/components/layout/TestnetBanner');
    render(<TestnetBanner />);
    expect(screen.getByText(/TESTNET — transactions do not use real funds/)).toBeInTheDocument();
  });

  it('renders nothing on mainnet', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'mainnet';
    const { TestnetBanner } = await import('@/components/layout/TestnetBanner');
    const { container } = render(<TestnetBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
