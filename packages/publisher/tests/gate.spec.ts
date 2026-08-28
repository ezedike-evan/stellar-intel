import { describe, it, expect } from 'vitest';
import {
  evaluatePublishGate,
  isOverrideEnabled,
  PROBE_MAINNET_READINESS_DAYS,
  type ProbeCoverageSummary,
} from '../src/gate';

const TESTNET_CONTRACT = 'CCZ54NTEOVL2DKWCGJA5XHTHOGRDS7JHFKYWEC6QH2IMZLYNM3FBFKDG';
const MAINNET_CONTRACT = 'CMAINNETEXAMPLE000000000000000000000000000000000000000000';

function coverage(overrides: Partial<ProbeCoverageSummary> = {}): ProbeCoverageSummary {
  return {
    fleetThresholdMet: true,
    thresholdDays: PROBE_MAINNET_READINESS_DAYS,
    anchors: [
      { anchorId: 'cowrie', continuousDays: 120, thresholdMet: true },
      { anchorId: 'ngnc', continuousDays: 95, thresholdMet: true },
    ],
    ...overrides,
  };
}

const SHORT: ProbeCoverageSummary = coverage({
  fleetThresholdMet: false,
  anchors: [
    { anchorId: 'cowrie', continuousDays: 120, thresholdMet: true },
    { anchorId: 'ngnc', continuousDays: 12, thresholdMet: false },
    { anchorId: 'mykobo', continuousDays: 3, thresholdMet: false },
  ],
});

describe('evaluatePublishGate — testnet', () => {
  it('allows a testnet publish with no coverage at all', () => {
    const decision = evaluatePublishGate({
      network: 'testnet',
      coverage: null,
      overrideEnabled: false,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.allowed && decision.reason).toBe('testnet');
  });

  it('allows a testnet publish even when the fleet is far short', () => {
    const decision = evaluatePublishGate({
      network: 'testnet',
      coverage: SHORT,
      overrideEnabled: false,
    });

    expect(decision.allowed).toBe(true);
  });
});

describe('evaluatePublishGate — mainnet', () => {
  it('allows a publish once the whole fleet has met the threshold', () => {
    const decision = evaluatePublishGate({
      network: 'mainnet',
      coverage: coverage(),
      overrideEnabled: false,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.allowed && decision.reason).toBe('coverage_met');
  });

  it('blocks a publish when any anchor is below the threshold', () => {
    const decision = evaluatePublishGate({
      network: 'mainnet',
      coverage: SHORT,
      overrideEnabled: false,
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error('unreachable');

    expect(decision.reason).toBe('insufficient_probe_coverage');
    expect(decision.thresholdDays).toBe(90);
    // Only the short anchors, worst first — an operator reading the alert
    // wants to know which anchor is furthest from ready.
    expect(decision.shortfall).toEqual([
      { anchorId: 'mykobo', continuousDays: 3 },
      { anchorId: 'ngnc', continuousDays: 12 },
    ]);
    expect(decision.message).toContain('mykobo');
  });

  it('blocks when coverage could not be determined at all', () => {
    const decision = evaluatePublishGate({
      network: 'mainnet',
      coverage: null,
      overrideEnabled: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toBe('coverage_unavailable');
  });

  it('blocks a mainnet run pointed at the testnet contract, whatever the coverage', () => {
    const decision = evaluatePublishGate({
      network: 'mainnet',
      coverage: coverage(),
      overrideEnabled: false,
      contractId: TESTNET_CONTRACT,
      testnetContractId: TESTNET_CONTRACT,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toBe('testnet_contract_on_mainnet');
  });

  it('does not let the override past a testnet contract on mainnet', () => {
    // Coverage can be overridden — a misconfigured contract id cannot, because
    // no state of the probe ledger makes writing to the wrong chain correct.
    const decision = evaluatePublishGate({
      network: 'mainnet',
      coverage: coverage(),
      overrideEnabled: true,
      contractId: TESTNET_CONTRACT,
      testnetContractId: TESTNET_CONTRACT,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toBe('testnet_contract_on_mainnet');
  });

  it('allows a mainnet contract that differs from the testnet one', () => {
    const decision = evaluatePublishGate({
      network: 'mainnet',
      coverage: coverage(),
      overrideEnabled: false,
      contractId: MAINNET_CONTRACT,
      testnetContractId: TESTNET_CONTRACT,
    });

    expect(decision.allowed).toBe(true);
  });
});

describe('evaluatePublishGate — override', () => {
  it('lets an under-covered mainnet publish through when enabled', () => {
    const decision = evaluatePublishGate({
      network: 'mainnet',
      coverage: SHORT,
      overrideEnabled: true,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.allowed && decision.reason).toBe('override');
  });

  it('lets an unavailable-coverage mainnet publish through when enabled', () => {
    const decision = evaluatePublishGate({
      network: 'mainnet',
      coverage: null,
      overrideEnabled: true,
    });

    expect(decision.allowed).toBe(true);
  });
});

describe('isOverrideEnabled', () => {
  it('enables only on the exact string "true"', () => {
    expect(isOverrideEnabled({ PUBLISH_GATE_OVERRIDE: 'true' })).toBe(true);
  });

  // The whole point of an exact compare: under a truthiness check, the string
  // someone writes to turn the override OFF turns it on.
  it.each(['false', '0', '1', 'TRUE', 'True', 'yes', '', undefined])(
    'stays disabled for %o',
    (value) => {
      expect(isOverrideEnabled({ PUBLISH_GATE_OVERRIDE: value })).toBe(false);
    }
  );
});
