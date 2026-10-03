import { describe, it, expect } from 'vitest';
import { evaluate } from '../scripts/check-registry.mjs';

const ALLOWLIST = {};

describe('check-registry: evaluate (tiered snapshot)', () => {
  const snapshot = {
    tiers: {
      routable: ['routable.example'],
      healthOnly: ['healthonly.example'],
      excluded: ['excluded.example'],
    },
  };

  it('passes a routable anchor (sep6/sep24) that is in tiers.routable', () => {
    const anchors = [{ id: 'a', name: 'A', homeDomain: 'routable.example', seps: ['sep6'] }];
    const [result] = evaluate(anchors, snapshot, ALLOWLIST);
    expect(result.ok).toBe(true);
    expect(result.tier).toBe('routable');
  });

  it('passes a SEP-31-only anchor that is in tiers.healthOnly', () => {
    const anchors = [{ id: 'b', name: 'B', homeDomain: 'healthonly.example', seps: ['sep31'] }];
    const [result] = evaluate(anchors, snapshot, ALLOWLIST);
    expect(result.ok).toBe(true);
    expect(result.tier).toBe('health-only');
  });

  it('fails a SEP-6 anchor that is only in tiers.healthOnly', () => {
    const anchors = [{ id: 'c', name: 'C', homeDomain: 'healthonly.example', seps: ['sep6'] }];
    const [result] = evaluate(anchors, snapshot, ALLOWLIST);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/tiers\.routable/);
  });

  it('fails an excluded anchor even if allowlisted', () => {
    const anchors = [{ id: 'd', name: 'D', homeDomain: 'excluded.example', seps: ['sep6'] }];
    const [result] = evaluate(anchors, snapshot, { d: 'test override' });
    expect(result.ok).toBe(false);
    expect(result.forcedFail).toBe(true);
    expect(result.tier).toBe('excluded');
  });

  it('has no tier requirement for an anchor with none of sep6/sep24/sep31', () => {
    const anchors = [{ id: 'e', name: 'E', homeDomain: 'unlisted.example', seps: ['sep10'] }];
    const [result] = evaluate(anchors, snapshot, ALLOWLIST);
    expect(result.ok).toBe(true);
    expect(result.tier).toBeNull();
  });
});

describe('check-registry: evaluate (legacy snapshot, no tiers)', () => {
  const snapshot = { transferCapableDomains: ['legacy.example'] };

  it('uses transferCapableDomains directly', () => {
    const anchors = [
      { id: 'f', name: 'F', homeDomain: 'legacy.example', seps: ['sep6'] },
      { id: 'g', name: 'G', homeDomain: 'missing.example', seps: ['sep6'] },
    ];
    const [ok, fail] = evaluate(anchors, snapshot, ALLOWLIST);
    expect(ok.ok).toBe(true);
    expect(fail.ok).toBe(false);
    expect(fail.reason).toMatch(/transfer-capable set/);
  });

  it('still allows ALLOWLIST to rescue a legacy failure', () => {
    const anchors = [{ id: 'h', name: 'H', homeDomain: 'missing.example', seps: ['sep6'] }];
    const [result] = evaluate(anchors, snapshot, { h: 'known good, survey blind spot' });
    expect(result.ok).toBe(true);
    expect(result.allowlisted).toBe(true);
  });
});
