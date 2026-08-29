import { describe, it, expect } from 'vitest';
import { stepTimeEstimate } from '@/lib/stellar/step-estimates';

describe('stepTimeEstimate', () => {
  it('returns an estimate for every non-terminal execution step', () => {
    const steps = ['authenticating', 'initiating', 'kyc', 'form', 'building', 'signing'] as const;
    for (const step of steps) {
      expect(stepTimeEstimate(step)).toMatch(/^~/);
    }
  });

  it('returns null for idle, done, and error', () => {
    expect(stepTimeEstimate('idle')).toBeNull();
    expect(stepTimeEstimate('done')).toBeNull();
    expect(stepTimeEstimate('error')).toBeNull();
  });
});
