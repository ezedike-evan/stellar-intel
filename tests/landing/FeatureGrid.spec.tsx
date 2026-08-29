import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FeatureGrid } from '@/components/landing/FeatureGrid';

const FEATURES = [
  { step: '01', title: 'Pick your corridor', body: 'Choose a destination and amount.' },
  { step: '02', title: 'Compare live quotes', body: 'We pull live SEP-38 quotes.' },
  { step: '03', title: 'Execute in one click', body: 'Sign once and settle on Stellar.' },
];

describe('FeatureGrid', () => {
  it('matches the visual snapshot for a fixed feature list', () => {
    const { container } = render(<FeatureGrid features={FEATURES} />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
