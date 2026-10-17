import { describe, it, expect } from 'vitest';
import { isIndicativeRateSource } from '@/types';

describe('isIndicativeRateSource', () => {
  it('treats sep38 as firm, not indicative', () => {
    expect(isIndicativeRateSource('sep38')).toBe(false);
  });

  it('treats sep24-fee, sep6-info, and sep6-fee as indicative', () => {
    expect(isIndicativeRateSource('sep24-fee')).toBe(true);
    expect(isIndicativeRateSource('sep6-info')).toBe(true);
    expect(isIndicativeRateSource('sep6-fee')).toBe(true);
  });

  it('treats unavailable as not indicative (there is no rate to caveat)', () => {
    expect(isIndicativeRateSource('unavailable')).toBe(false);
  });
});
