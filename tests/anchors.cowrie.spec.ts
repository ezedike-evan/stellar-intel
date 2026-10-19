import { describe, it, expect } from 'vitest';
import { ANCHORS } from '@/constants/anchors';

describe('cowrie.exchange anchor config', () => {
  const cowrie = ANCHORS.find((a) => a.id === 'cowrie');

  it('is present in the anchors list', () => {
    expect(cowrie).toBeDefined();
  });

  it('has seps including sep6 and sep10', () => {
    expect(cowrie?.seps).toContain('sep6');
    expect(cowrie?.seps).toContain('sep10');
  });

  it('has an NGN corridor', () => {
    expect(cowrie?.corridors).toContain('ngnt-ngn');
  });
});
