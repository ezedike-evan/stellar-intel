import { describe, it, expect } from 'vitest';
import { ANCHORS } from '@/constants/anchors';

describe('fchain.io triage (B033)', () => {
  it('is bucketed (not included in ANCHORS) because it only supports crypto assets for deposit/withdraw (no fiat settlement)', () => {
    const fchain = ANCHORS.find((a) => a.id === 'fchain' || a.homeDomain === 'fchain.io');
    expect(fchain).toBeUndefined();
  });
});
