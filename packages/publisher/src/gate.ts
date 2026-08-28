// ─── Pre-publish gate (Issue #786) ────────────────────────────────────────────
//
// ROADMAP: "Accumulate >= 90 days of probe observations before any mainnet
// oracle publish." Until now nothing enforced that. If a mainnet contract id
// were configured tomorrow, runBatch would publish with zero days of history —
// the empty-credit-bureau launch the roadmap explicitly warns against.
//
// The gate lives in this package rather than in the app because it guards the
// publish path, and the publish path is here. But the coverage data it needs
// lives behind ReputationStore in `lib/reputation/`, which is app code that
// imports *this* package. So the shape below is declared structurally: the
// app's existing ProbeCoverageReport already satisfies it, and passes straight
// in with no adapter, while this package keeps zero dependencies on the app.

import type { StellarNetwork } from './network.js';

/** Days of continuous probe coverage required before a mainnet publish. */
export const PROBE_MAINNET_READINESS_DAYS = 90;

/**
 * The subset of the app's `ProbeCoverageReport` this gate reads.
 *
 * Structural on purpose — see the module comment. Widening this to the full
 * report type would mean importing app code into a published package.
 */
export interface ProbeCoverageSummary {
  /** True when every registered anchor has met the threshold. */
  fleetThresholdMet: boolean;
  /** The threshold the report was built against, in days. */
  thresholdDays: number;
  anchors: readonly {
    anchorId: string;
    continuousDays: number;
    thresholdMet: boolean;
  }[];
}

export interface GateInput {
  network: StellarNetwork;
  /**
   * Probe coverage for the fleet, or `null` when it could not be loaded.
   *
   * `null` is not "unknown, proceed" — it is a refusal on mainnet. A caller
   * with no way to read coverage (the CLI, which holds a QueryExecutor and no
   * ReputationStore) is therefore safe by construction rather than by
   * remembering to pass something.
   */
  coverage: ProbeCoverageSummary | null;
  /** Resolved oracle contract id, checked against the testnet one below. */
  contractId?: string | undefined;
  /** The known testnet contract id, so a mainnet run pointed at it is caught. */
  testnetContractId?: string | undefined;
  overrideEnabled: boolean;
}

export type GateAllowReason = 'testnet' | 'coverage_met' | 'override';

export type GateBlockReason =
  | 'insufficient_probe_coverage'
  | 'coverage_unavailable'
  | 'testnet_contract_on_mainnet';

export interface GateShortfall {
  anchorId: string;
  continuousDays: number;
}

export type GateDecision =
  | { allowed: true; reason: GateAllowReason }
  | {
      allowed: false;
      reason: GateBlockReason;
      thresholdDays: number;
      shortfall: GateShortfall[];
      message: string;
    };

/**
 * Reads the override flag with an exact string compare.
 *
 * Not truthiness: `PUBLISH_GATE_OVERRIDE=false` is how someone turns the
 * override *off*, and under a truthy check that string would turn it on.
 */
export function isOverrideEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env['PUBLISH_GATE_OVERRIDE'] === 'true';
}

/**
 * Decides whether a publish may proceed. Pure — no I/O, no clock, no env read.
 *
 * Testnet is ungated by design: the whole point of the testnet deployment is to
 * exercise the pipeline before there is any history to gate on.
 */
export function evaluatePublishGate(input: GateInput): GateDecision {
  const { network, coverage, overrideEnabled, contractId, testnetContractId } = input;

  if (network !== 'mainnet') {
    return { allowed: true, reason: 'testnet' };
  }

  // Checked before coverage, and not overridable. A mainnet run pointed at the
  // testnet contract is a misconfiguration in every case — there is no state of
  // the probe ledger that makes it correct, so probe history is not the
  // question and the override is not the answer.
  if (contractId && testnetContractId && contractId === testnetContractId) {
    return {
      allowed: false,
      reason: 'testnet_contract_on_mainnet',
      thresholdDays: coverage?.thresholdDays ?? PROBE_MAINNET_READINESS_DAYS,
      shortfall: [],
      message:
        `Refusing to publish: STELLAR_NETWORK is mainnet but the resolved oracle ` +
        `contract (${contractId}) is the testnet deployment. Set ORACLE_CONTRACT_ID ` +
        `to the mainnet contract, or set STELLAR_NETWORK=testnet.`,
    };
  }

  if (overrideEnabled) {
    return { allowed: true, reason: 'override' };
  }

  if (coverage === null) {
    return {
      allowed: false,
      reason: 'coverage_unavailable',
      thresholdDays: PROBE_MAINNET_READINESS_DAYS,
      shortfall: [],
      message:
        'Refusing to publish: probe coverage could not be determined, and a mainnet ' +
        'publish must not proceed on an unverified probe history. Set ' +
        'PUBLISH_GATE_OVERRIDE=true to publish anyway.',
    };
  }

  if (coverage.fleetThresholdMet) {
    return { allowed: true, reason: 'coverage_met' };
  }

  const shortfall = coverage.anchors
    .filter((a) => !a.thresholdMet)
    .map((a) => ({ anchorId: a.anchorId, continuousDays: a.continuousDays }))
    .sort((a, b) => a.continuousDays - b.continuousDays);

  const worst = shortfall[0];

  return {
    allowed: false,
    reason: 'insufficient_probe_coverage',
    thresholdDays: coverage.thresholdDays,
    shortfall,
    message:
      `Refusing to publish: ${shortfall.length} anchor(s) are below the ` +
      `${coverage.thresholdDays}-day probe-coverage threshold` +
      (worst ? ` (lowest: ${worst.anchorId} at ${worst.continuousDays} days)` : '') +
      '. Set PUBLISH_GATE_OVERRIDE=true to publish anyway.',
  };
}
