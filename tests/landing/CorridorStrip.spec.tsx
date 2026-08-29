import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/constants', () => ({
  CORRIDORS: [
    { id: 'usdc-ngn', from: 'USDC', to: 'NGN', countryCode: 'NG', countryName: 'Nigeria' },
    { id: 'usdc-kes', from: 'USDC', to: 'KES', countryCode: 'KE', countryName: 'Kenya' },
  ],
}));

import { CorridorStrip } from '@/components/landing/CorridorStrip';

describe('CorridorStrip', () => {
  it('matches the visual snapshot for a fixed corridor list', () => {
    const { container } = render(<CorridorStrip />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
