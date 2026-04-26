import { describe, it, expect } from 'vitest';
import {
  ANCHORS,
  CORRIDORS,
  ANCHOR_HOME_DOMAINS,
  getAnchorById,
  getAnchorsByCorridorId,
  getCorridorById,
  isValidCorridorId,
} from '@/lib/stellar/anchors';

describe('ANCHORS', () => {
  it('contains MoneyGram, Cowrie, and Anclap', () => {
    const ids = ANCHORS.map((a) => a.id);
    expect(ids).toContain('moneygram');
    expect(ids).toContain('cowrie');
    expect(ids).toContain('anclap');
    expect(ids).toHaveLength(3);
  });

  it('MoneyGram covers all five primary corridors', () => {
    const mg = ANCHORS.find((a) => a.id === 'moneygram')!;
    expect(mg.corridors).toContain('usdc-ngn');
    expect(mg.corridors).toContain('usdc-kes');
    expect(mg.corridors).toContain('usdc-ghs');
    expect(mg.corridors).toContain('usdc-mxn');
    expect(mg.corridors).toContain('usdc-brl');
  });

  it('Cowrie is only in usdc-ngn', () => {
    const cowrie = ANCHORS.find((a) => a.id === 'cowrie')!;
    expect(cowrie.corridors).toEqual(['usdc-ngn']);
  });

  it('Anclap covers usdc-ars and usdc-pen', () => {
    const anclap = ANCHORS.find((a) => a.id === 'anclap')!;
    expect(anclap.corridors).toContain('usdc-ars');
    expect(anclap.corridors).toContain('usdc-pen');
  });
});

describe('CORRIDORS', () => {
  it('contains 7 corridors', () => {
    expect(CORRIDORS).toHaveLength(7);
  });

  it('contains the expected corridor IDs', () => {
    const ids = CORRIDORS.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'usdc-ngn',
        'usdc-kes',
        'usdc-ghs',
        'usdc-mxn',
        'usdc-brl',
        'usdc-ars',
        'usdc-pen',
      ])
    );
  });
});

describe('ANCHOR_HOME_DOMAINS', () => {
  it('maps moneygram to stellar.moneygram.com', () => {
    expect(ANCHOR_HOME_DOMAINS['moneygram']).toBe('stellar.moneygram.com');
  });

  it('maps cowrie to cowrie.exchange', () => {
    expect(ANCHOR_HOME_DOMAINS['cowrie']).toBe('cowrie.exchange');
  });

  it('maps anclap to anclap.com', () => {
    expect(ANCHOR_HOME_DOMAINS['anclap']).toBe('anclap.com');
  });
});

describe('getAnchorById', () => {
  it('returns the MoneyGram anchor', () => {
    const anchor = getAnchorById('moneygram');
    expect(anchor.id).toBe('moneygram');
    expect(anchor.homeDomain).toBe('stellar.moneygram.com');
  });

  it('returns the Cowrie anchor', () => {
    const anchor = getAnchorById('cowrie');
    expect(anchor.id).toBe('cowrie');
    expect(anchor.homeDomain).toBe('cowrie.exchange');
  });

  it('throws a descriptive error for an unknown id', () => {
    expect(() => getAnchorById('unknown')).toThrow(/Unknown anchor.*"unknown"/);
  });
});

describe('getAnchorsByCorridorId', () => {
  it('returns MoneyGram and Cowrie for usdc-ngn', () => {
    const anchors = getAnchorsByCorridorId('usdc-ngn');
    const ids = anchors.map((a) => a.id);
    expect(ids).toContain('moneygram');
    expect(ids).toContain('cowrie');
    expect(ids).toHaveLength(2);
  });

  it('returns only MoneyGram for usdc-kes', () => {
    const anchors = getAnchorsByCorridorId('usdc-kes');
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.id).toBe('moneygram');
  });

  it('returns only MoneyGram for usdc-mxn', () => {
    const anchors = getAnchorsByCorridorId('usdc-mxn');
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.id).toBe('moneygram');
  });

  it('returns only Anclap for usdc-ars', () => {
    const anchors = getAnchorsByCorridorId('usdc-ars');
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.id).toBe('anclap');
  });

  it('returns an empty array for an unknown corridor', () => {
    expect(getAnchorsByCorridorId('usdc-xyz')).toEqual([]);
  });
});

describe('getCorridorById', () => {
  it('returns the Nigeria corridor', () => {
    const corridor = getCorridorById('usdc-ngn');
    expect(corridor.to).toBe('NGN');
    expect(corridor.countryCode).toBe('NG');
  });

  it('returns the Argentina corridor', () => {
    const corridor = getCorridorById('usdc-ars');
    expect(corridor.to).toBe('ARS');
    expect(corridor.countryCode).toBe('AR');
  });

  it('throws a descriptive error for an unknown id', () => {
    expect(() => getCorridorById('unknown')).toThrow(/Unknown corridor.*"unknown"/);
  });
});

describe('isValidCorridorId', () => {
  it('returns true for usdc-ngn', () => {
    expect(isValidCorridorId('usdc-ngn')).toBe(true);
  });

  it('returns true for usdc-ars', () => {
    expect(isValidCorridorId('usdc-ars')).toBe(true);
  });

  it('returns false for an invalid id', () => {
    expect(isValidCorridorId('invalid')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isValidCorridorId('')).toBe(false);
  });
});
