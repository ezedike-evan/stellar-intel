import { describe, it, expect } from 'vitest';
import { ANCHORS, CORRIDORS } from '@/constants/anchors';

describe('Anclap anchor', () => {
  const anclap = ANCHORS.find((a) => a.id === 'anclap');

  it('is present in ANCHORS list', () => {
    expect(anclap).toBeDefined();
  });

  it('has usdc-ars corridor', () => {
    expect(anclap?.corridors).toContain('usdc-ars');
  });

  it('has usdc-pen corridor', () => {
    expect(anclap?.corridors).toContain('usdc-pen');
  });

  it('declares sep6 capability', () => {
    expect(anclap?.seps).toContain('sep6');
  });

  it('declares sep24 capability', () => {
    expect(anclap?.seps).toContain('sep24');
  });

  it('usdc-ars corridor exists in CORRIDORS list', () => {
    expect(CORRIDORS.some((c) => c.id === 'usdc-ars')).toBe(true);
  });

  it('usdc-pen corridor exists in CORRIDORS list', () => {
    expect(CORRIDORS.some((c) => c.id === 'usdc-pen')).toBe(true);
  });
});
