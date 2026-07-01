import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/constants', () => ({
  CORRIDORS: [
    { id: 'usdc-ngn', from: 'USDC', to: 'NGN', countryCode: 'NG', countryName: 'Nigeria' },
    { id: 'usdc-brl', from: 'USDC', to: 'BRL', countryCode: 'BR', countryName: 'Brazil' },
    // Same destination (BR/BRL) as usdc-brl — should be deduplicated.
    { id: 'brl-brl', from: 'BRL', to: 'BRL', countryCode: 'BR', countryName: 'Brazil' },
  ],
}));

import { CorridorStrip } from '@/components/landing/CorridorStrip';

describe('CorridorStrip', () => {
  it('renders a chip per distinct destination with its currency code', () => {
    render(<CorridorStrip />);
    expect(screen.getByText('NGN')).toBeInTheDocument();
    expect(screen.getByText('BRL')).toBeInTheDocument();
  });

  it('deduplicates corridors that share a destination', () => {
    render(<CorridorStrip />);
    expect(screen.getAllByText('BRL')).toHaveLength(1);
  });

  it('renders the correct flag emoji for each corridor country', () => {
    render(<CorridorStrip />);
    expect(screen.getByText('🇳🇬')).toBeInTheDocument(); // Nigeria
    expect(screen.getByText('🇧🇷')).toBeInTheDocument(); // Brazil
  });

  it('exposes the country name to assistive tech', () => {
    render(<CorridorStrip />);
    expect(screen.getByText('Nigeria')).toBeInTheDocument();
  });
});
