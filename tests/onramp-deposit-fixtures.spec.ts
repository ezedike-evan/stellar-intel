import { describe, it, expect } from 'vitest';
import { ANCHORS } from '@/constants';
import { ONRAMP_DEPOSIT_CAPTURES } from './fixtures/onramp';

// #1095 — "every registered anchor has a fixture or a documented reason it
// has none" is the acceptance criteria itself, not just a description; assert
// it directly so adding an anchor to constants/anchors.ts without capturing
// its deposit fixture fails loudly instead of leaving a silent gap.

describe('onramp deposit fixtures (#1095)', () => {
  it('has a capture for every registered anchor', () => {
    for (const anchor of ANCHORS) {
      expect(
        ONRAMP_DEPOSIT_CAPTURES[anchor.id],
        `${anchor.id} is registered in constants/anchors.ts but has no tests/fixtures/onramp/${anchor.id}.json`
      ).toBeDefined();
    }
  });

  it("carries no capture for an anchor that isn't registered", () => {
    const registeredIds = new Set(ANCHORS.map((a) => a.id));
    for (const id of Object.keys(ONRAMP_DEPOSIT_CAPTURES)) {
      expect(registeredIds.has(id), `${id}.json exists but is not in constants/anchors.ts`).toBe(
        true
      );
    }
  });

  it('every capture carries a capturedAt timestamp', () => {
    for (const [id, capture] of Object.entries(ONRAMP_DEPOSIT_CAPTURES)) {
      expect(capture.capturedAt, `${id} is missing capturedAt`).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
      );
    }
  });

  it('matches each capture against the asset code actually registered for that anchor', () => {
    const byId = new Map(ANCHORS.map((a) => [a.id, a]));
    for (const [id, capture] of Object.entries(ONRAMP_DEPOSIT_CAPTURES)) {
      expect(capture.registeredAssetCode).toBe(byId.get(id)?.assetCode);
    }
  });

  it('every non-null supportsDeposit is backed by a reason when false, or a captured info block when true', () => {
    for (const [id, capture] of Object.entries(ONRAMP_DEPOSIT_CAPTURES)) {
      if (capture.supportsDeposit === false) {
        expect(
          capture.reason,
          `${id}: supportsDeposit is false but reason is missing`
        ).toBeTruthy();
      }
      if (capture.supportsDeposit === true) {
        expect(
          capture.info,
          `${id}: supportsDeposit is true but no info was captured`
        ).toBeTruthy();
      }
      if (capture.supportsDeposit === null) {
        expect(capture.reachable, `${id}: supportsDeposit is null but reachable is not false`).toBe(
          false
        );
      }
    }
  });
});
