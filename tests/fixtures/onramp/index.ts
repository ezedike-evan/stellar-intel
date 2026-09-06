/**
 * Deposit-side capability fixtures for every registered anchor (#1095).
 *
 * Each `tests/fixtures/onramp/<id>.json` is a hand-captured snapshot of the
 * anchor's own GET /info response for its registered asset — or, when the
 * anchor is unreachable, a record of that reachability failure instead —
 * captured the same way `tests/fixtures/sep38/capability-capture.json` is:
 * by hand against the anchor's own advertised transfer server, with a
 * `capturedAt` timestamp rather than treated as a live, ever-fresh value.
 *
 * The onramp scaffolds (#1093's SEP-6 deposit scaffold, #1097's onramp E2E
 * scaffold) need realistic anchor-shaped inputs; capturing them once here
 * keeps every later test deterministic instead of each one inventing its
 * own plausible-looking JSON.
 */
import moneygram from './moneygram.json';
import cowrie from './cowrie.json';
import anclap from './anclap.json';
import ngnc from './ngnc.json';
import ntokens from './ntokens.json';
import zeam from './zeam.json';

export interface OnrampDepositCapture {
  _comment: string;
  capturedAt: string;
  anchorId: string;
  homeDomain: string;
  registeredAssetCode: string;
  transferServer?: string;
  transferServerSep0024?: string;
  /** False when the anchor's declared transfer server could not be reached at capture time. */
  reachable: boolean;
  /**
   * Whether the anchor's own GET /info advertises deposit as enabled for its
   * *registered* asset code specifically — not merely "does this anchor have
   * a deposit endpoint at all". `null` when reachability failed and support
   * could not be determined either way.
   */
  supportsDeposit: boolean | null;
  /** Present whenever supportsDeposit is not `true`, explaining why. */
  reason?: string;
  /** Raw captured GET /info body, when the anchor was reachable. */
  info?: { deposit: Record<string, Record<string, unknown>> };
}

/** Every registered anchor (constants/anchors.ts), keyed by id — one entry each, no omissions. */
export const ONRAMP_DEPOSIT_CAPTURES: Record<string, OnrampDepositCapture> = {
  moneygram,
  cowrie,
  anclap,
  ngnc,
  ntokens,
  zeam,
};

/** Anchors whose registered asset can actually be deposited today, per the capture above. */
export const ANCHORS_SUPPORTING_DEPOSIT: string[] = Object.values(ONRAMP_DEPOSIT_CAPTURES)
  .filter((capture) => capture.supportsDeposit === true)
  .map((capture) => capture.anchorId);
