import { ANCHORS, CORRIDORS } from '@/constants/anchors';
import { registryShapeViolations } from '@/lib/stellar/anchors';
import { describe, it, expect } from 'vitest';
import type { Anchor, Corridor } from '@/types';

describe('Anchor registry shape', () => {
  it('has no shape violations in the production registry', () => {
    const violations = registryShapeViolations(ANCHORS, CORRIDORS);
    expect(violations).toEqual([]);
  });

  describe('registryShapeViolations pure logic', () => {
    const fakeCorridors: Corridor[] = [
      { id: 'usdc-ngn', from: 'USDC', to: 'NGN', countryCode: 'NG', countryName: 'Nigeria' },
      { id: 'usdc-php', from: 'USDC', to: 'PHP', countryCode: 'PH', countryName: 'Philippines' },
    ];

    it('rejects unverifiedCorridors that are not in corridors', () => {
      const fakeAnchors: Anchor[] = [
        {
          id: 'fake1',
          name: 'Fake 1',
          homeDomain: 'fake1.com',
          assetCode: 'USDC',
          assetIssuer: 'issuer1',
          corridors: ['usdc-ngn'],
          unverifiedCorridors: ['usdc-php'],
        },
      ];
      const violations = registryShapeViolations(fakeAnchors, fakeCorridors);
      expect(violations).toContain("fake1: unverifiedCorridors contains 'usdc-php' but it is not in corridors");
    });

    it('rejects sep31Corridors that are not disjoint from corridors', () => {
      const fakeAnchors: Anchor[] = [
        {
          id: 'fake2',
          name: 'Fake 2',
          homeDomain: 'fake2.com',
          assetCode: 'USDC',
          assetIssuer: 'issuer2',
          seps: ['sep31'],
          corridors: ['usdc-ngn'],
          sep31Corridors: ['usdc-ngn'],
        },
      ];
      const violations = registryShapeViolations(fakeAnchors, fakeCorridors);
      expect(violations).toContain("fake2: sep31Corridors and corridors are not disjoint ('usdc-ngn' is in both)");
    });

    it('rejects sep31Corridors containing unknown corridors', () => {
      const fakeAnchors: Anchor[] = [
        {
          id: 'fake3',
          name: 'Fake 3',
          homeDomain: 'fake3.com',
          assetCode: 'USDC',
          assetIssuer: 'issuer3',
          seps: ['sep31'],
          corridors: [],
          sep31Corridors: ['usdc-xxx'],
        },
      ];
      const violations = registryShapeViolations(fakeAnchors, fakeCorridors);
      expect(violations).toContain("fake3: sep31Corridors contains 'usdc-xxx' which is not a known corridor");
    });

    it('rejects sep31Corridors when sep31 is missing from seps', () => {
      const fakeAnchors: Anchor[] = [
        {
          id: 'fake4',
          name: 'Fake 4',
          homeDomain: 'fake4.com',
          assetCode: 'USDC',
          assetIssuer: 'issuer4',
          seps: ['sep24'],
          corridors: [],
          sep31Corridors: ['usdc-ngn'],
        },
      ];
      const violations = registryShapeViolations(fakeAnchors, fakeCorridors);
      expect(violations).toContain("fake4: has sep31Corridors but 'sep31' is not in seps");
    });
  });
});
