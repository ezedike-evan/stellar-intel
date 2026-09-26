import { describe, it, expect } from 'vitest';
import { ANCHORS, CORRIDORS } from '@/constants/anchors';

describe('Anclap anchor', () => {
  const anclap = ANCHORS.find((a) => a.id === 'anclap');

  it('is present in ANCHORS list', () => {
    expect(anclap).toBeDefined();
  });

  it('anchors ARS with the correct issuer', () => {
    expect(anclap?.assetCode).toBe('ARS');
    expect(anclap?.assetIssuer).toBe('GCYE7C77EB5AWAA25R5XMWNI2EDOKTTFTTPZKM2SR5DI4B4WFD52DARS');
  });

  it('serves the ars-ars corridor', () => {
    expect(anclap?.corridors).toContain('ars-ars');
    expect(anclap?.corridors).not.toContain('usdc-ars');
  });

  it('serves the pen-pen corridor', () => {
    expect(anclap?.corridors).toContain('pen-pen');
    expect(anclap?.corridors).not.toContain('usdc-pen');
  });

  it('declares sep6 capability', () => {
    expect(anclap?.seps).toContain('sep6');
  });

  it('declares sep24 capability', () => {
    expect(anclap?.seps).toContain('sep24');
  });

  it('ars-ars corridor exists in CORRIDORS list', () => {
    expect(CORRIDORS.some((c) => c.id === 'ars-ars')).toBe(true);
  });

  it('pen-pen corridor exists in CORRIDORS list', () => {
    expect(CORRIDORS.some((c) => c.id === 'pen-pen')).toBe(true);
  });
});
