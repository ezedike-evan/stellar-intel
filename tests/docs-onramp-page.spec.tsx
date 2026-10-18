import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import OnrampDocsPage, { metadata } from '@/app/docs/onramp/page';

describe('On-ramp docs page (#1495)', () => {
  it('renders the heading and primary endpoint paths', () => {
    const { getByRole, getAllByText } = render(<OnrampDocsPage />);

    expect(getByRole('heading', { level: 1, name: /on-ramp/i })).toBeDefined();

    expect(getAllByText(/GET \/api\/v1\/onramp\/quote/i).length).toBeGreaterThan(0);
    expect(getAllByText(/POST \/api\/v1\/intent\/onramp/i).length).toBeGreaterThan(0);
  });

  it('exports page metadata', () => {
    expect(metadata.title).toBeDefined();
    expect(metadata.description).toBeDefined();
  });
});
