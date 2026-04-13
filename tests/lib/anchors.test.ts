import { describe, it, expect } from 'vitest'
import {
  ANCHORS,
  CORRIDORS,
  ANCHOR_HOME_DOMAINS,
  getAnchorById,
  getAnchorsByCorridorId,
  getCorridorById,
  isValidCorridorId,
} from '@/lib/stellar/anchors'

describe('ANCHORS', () => {
  it('contains exactly Cowrie, Flutterwave, and Bitso', () => {
    const ids = ANCHORS.map((a) => a.id)
    expect(ids).toContain('cowrie')
    expect(ids).toContain('flutterwave')
    expect(ids).toContain('bitso')
    expect(ids).toHaveLength(3)
  })

  it('Cowrie is only in usdc-ngn', () => {
    const cowrie = ANCHORS.find((a) => a.id === 'cowrie')!
    expect(cowrie.corridors).toEqual(['usdc-ngn'])
  })

  it('Flutterwave is in usdc-ngn, usdc-kes, and usdc-ghs', () => {
    const fw = ANCHORS.find((a) => a.id === 'flutterwave')!
    expect(fw.corridors).toContain('usdc-ngn')
    expect(fw.corridors).toContain('usdc-kes')
    expect(fw.corridors).toContain('usdc-ghs')
  })

  it('Bitso is in usdc-mxn and usdc-brl', () => {
    const bitso = ANCHORS.find((a) => a.id === 'bitso')!
    expect(bitso.corridors).toContain('usdc-mxn')
    expect(bitso.corridors).toContain('usdc-brl')
  })
})

describe('CORRIDORS', () => {
  it('contains exactly 5 corridors', () => {
    expect(CORRIDORS).toHaveLength(5)
  })

  it('contains the expected corridor IDs', () => {
    const ids = CORRIDORS.map((c) => c.id)
    expect(ids).toEqual(
      expect.arrayContaining(['usdc-ngn', 'usdc-kes', 'usdc-ghs', 'usdc-mxn', 'usdc-brl'])
    )
  })
})

describe('ANCHOR_HOME_DOMAINS', () => {
  it('maps cowrie to cowrie.exchange', () => {
    expect(ANCHOR_HOME_DOMAINS['cowrie']).toBe('cowrie.exchange')
  })

  it('maps flutterwave to flutterwave.com', () => {
    expect(ANCHOR_HOME_DOMAINS['flutterwave']).toBe('flutterwave.com')
  })

  it('maps bitso to bitso.com', () => {
    expect(ANCHOR_HOME_DOMAINS['bitso']).toBe('bitso.com')
  })
})

describe('getAnchorById', () => {
  it('returns the Cowrie anchor', () => {
    const anchor = getAnchorById('cowrie')
    expect(anchor.id).toBe('cowrie')
    expect(anchor.homeDomain).toBe('cowrie.exchange')
  })

  it('throws a descriptive error for an unknown id', () => {
    expect(() => getAnchorById('unknown')).toThrow(/Unknown anchor.*"unknown"/)
  })
})

describe('getAnchorsByCorridorId', () => {
  it('returns Cowrie and Flutterwave for usdc-ngn', () => {
    const anchors = getAnchorsByCorridorId('usdc-ngn')
    const ids = anchors.map((a) => a.id)
    expect(ids).toContain('cowrie')
    expect(ids).toContain('flutterwave')
    expect(ids).toHaveLength(2)
  })

  it('returns only Bitso for usdc-mxn', () => {
    const anchors = getAnchorsByCorridorId('usdc-mxn')
    expect(anchors).toHaveLength(1)
    expect(anchors[0].id).toBe('bitso')
  })

  it('returns only Flutterwave for usdc-kes', () => {
    const anchors = getAnchorsByCorridorId('usdc-kes')
    expect(anchors).toHaveLength(1)
    expect(anchors[0].id).toBe('flutterwave')
  })

  it('returns an empty array for an unknown corridor', () => {
    expect(getAnchorsByCorridorId('usdc-xyz')).toEqual([])
  })
})

describe('getCorridorById', () => {
  it('returns the Nigeria corridor', () => {
    const corridor = getCorridorById('usdc-ngn')
    expect(corridor.to).toBe('NGN')
    expect(corridor.countryCode).toBe('NG')
  })

  it('throws a descriptive error for an unknown id', () => {
    expect(() => getCorridorById('unknown')).toThrow(/Unknown corridor.*"unknown"/)
  })
})

describe('isValidCorridorId', () => {
  it('returns true for usdc-ngn', () => {
    expect(isValidCorridorId('usdc-ngn')).toBe(true)
  })

  it('returns false for an invalid id', () => {
    expect(isValidCorridorId('invalid')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isValidCorridorId('')).toBe(false)
  })
})
