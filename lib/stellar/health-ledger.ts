/**
 * lib/stellar/health-ledger.ts
 *
 * Reading the anchor health ledger as a dated artifact (#1098).
 *
 * `constants/anchor-health.json` is rewritten nightly by
 * scripts/validate-anchors.mjs and committed, so the file holds today's state
 * and git holds the series. That made the history real but unreachable: a
 * consumer who wanted last Tuesday's ledger had to clone the repo and walk
 * commits. This module keeps the committed file as the source of truth and adds
 * one thing on top of it — the ability to name a date and get the ledger as it
 * stood on that date, resolved from the same git history rather than a second,
 * drifting copy of the data.
 *
 * Past dates are read from the GitHub contents API at the commit that last
 * touched the file on or before that date. Nothing is mirrored or cached
 * server-side: if the committed file and this endpoint ever disagree, the
 * committed file is right by definition.
 */
import { getAnchorHealthLedger, type AnchorHealthLedger } from '@/lib/stellar/anchors';

/** `YYYY-MM-DD`, the granularity the nightly job actually writes at. */
export const LEDGER_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Path of the ledger inside the repository. */
export const LEDGER_PATH = 'constants/anchor-health.json';

/** Repository the history is read from. Overridable for a fork or a mirror. */
const LEDGER_REPO = (): string =>
  process.env.ANCHOR_HEALTH_LEDGER_REPO ?? 'ezedike-evan/stellar-intel';

/** Where the ledger in a response came from. */
export type LedgerSource =
  /** The file committed in this deployment — the source of truth. */
  | 'committed'
  /** A past revision of that same file, read back out of git history. */
  | 'git-history';

export interface LedgerArtifact {
  /**
   * The date this ledger describes, `YYYY-MM-DD`, taken from its own
   * `updatedAt`. This is the version: two fetches that return the same
   * `version` return the same ledger.
   */
  version: string;
  /** The date that was asked for, or null when the latest was asked for. */
  requestedDate: string | null;
  source: LedgerSource;
  /** Commit the ledger was read from; null for the committed (deployed) file. */
  commit: string | null;
  ledger: AnchorHealthLedger;
}

/** Reasons a lookup can fail that are not "something is broken". */
export class LedgerLookupError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_DATE' | 'NOT_FOUND' | 'UPSTREAM_UNAVAILABLE'
  ) {
    super(message);
    this.name = 'LedgerLookupError';
  }
}

/** The `YYYY-MM-DD` a ledger describes, from its own `updatedAt` timestamp. */
export function ledgerVersion(ledger: AnchorHealthLedger): string {
  const updatedAt = ledger.updatedAt;
  if (!updatedAt) return 'unknown';
  const parsed = new Date(updatedAt);
  return Number.isNaN(parsed.getTime()) ? 'unknown' : parsed.toISOString().slice(0, 10);
}

function assertValidDate(date: string): void {
  if (!LEDGER_DATE_PATTERN.test(date)) {
    throw new LedgerLookupError(`date must be YYYY-MM-DD, got "${date}"`, 'INVALID_DATE');
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new LedgerLookupError(`"${date}" is not a real date`, 'INVALID_DATE');
  }
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  // Unauthenticated GitHub API calls are limited to 60/hour per IP, which is
  // enough for occasional archive reads and not enough for a busy deployment.
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * The newest commit that touched the ledger on or before the end of `date`,
 * or null when the file did not exist yet.
 */
async function findCommitForDate(date: string): Promise<string | null> {
  const url =
    `https://api.github.com/repos/${LEDGER_REPO()}/commits` +
    `?path=${encodeURIComponent(LEDGER_PATH)}` +
    `&until=${encodeURIComponent(`${date}T23:59:59Z`)}&per_page=1`;

  let response: Response;
  try {
    response = await fetch(url, { headers: githubHeaders() });
  } catch (err) {
    throw new LedgerLookupError(
      `Could not reach the ledger history: ${err instanceof Error ? err.message : 'unknown error'}`,
      'UPSTREAM_UNAVAILABLE'
    );
  }

  if (!response.ok) {
    throw new LedgerLookupError(
      `Ledger history lookup failed with HTTP ${response.status}`,
      'UPSTREAM_UNAVAILABLE'
    );
  }

  const commits = (await response.json()) as Array<{ sha?: string }>;
  if (!Array.isArray(commits) || commits.length === 0) return null;
  return commits[0]?.sha ?? null;
}

/** The ledger file as it stood at one commit. */
async function fetchLedgerAtCommit(commit: string): Promise<AnchorHealthLedger> {
  const url = `https://raw.githubusercontent.com/${LEDGER_REPO()}/${commit}/${LEDGER_PATH}`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new LedgerLookupError(
      `Could not read the ledger at ${commit}: ${err instanceof Error ? err.message : 'unknown error'}`,
      'UPSTREAM_UNAVAILABLE'
    );
  }

  if (!response.ok) {
    throw new LedgerLookupError(
      `Reading the ledger at ${commit} failed with HTTP ${response.status}`,
      'UPSTREAM_UNAVAILABLE'
    );
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }

  // An archived revision is outside this deployment's control, so it gets
  // checked rather than trusted: a malformed one is the archive's problem to
  // report, not an unexplained 500 from this app.
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    typeof (parsed as AnchorHealthLedger).anchors !== 'object' ||
    (parsed as AnchorHealthLedger).anchors === null
  ) {
    throw new LedgerLookupError(
      `The ledger at ${commit} is not a valid anchor health ledger`,
      'UPSTREAM_UNAVAILABLE'
    );
  }

  return parsed as AnchorHealthLedger;
}

/**
 * The ledger this deployment was built with — today's, and the source of truth.
 */
export function latestLedgerArtifact(): LedgerArtifact {
  const ledger = getAnchorHealthLedger();
  return {
    version: ledgerVersion(ledger),
    requestedDate: null,
    source: 'committed',
    commit: null,
    ledger,
  };
}

/**
 * The ledger as it stood on `date` (`YYYY-MM-DD`).
 *
 * A date at or after the committed ledger's own version is answered from the
 * committed file rather than from git: the deployed file is the source of
 * truth, and asking for "today" should never depend on GitHub being reachable.
 * Anything earlier is resolved from history.
 *
 * Throws {@link LedgerLookupError} with INVALID_DATE for a malformed date,
 * NOT_FOUND when the ledger did not exist yet, and UPSTREAM_UNAVAILABLE when
 * the history cannot be read.
 */
export async function ledgerArtifactForDate(date: string): Promise<LedgerArtifact> {
  assertValidDate(date);

  const latest = latestLedgerArtifact();
  if (latest.version !== 'unknown' && date >= latest.version) {
    return { ...latest, requestedDate: date };
  }

  const commit = await findCommitForDate(date);
  if (!commit) {
    throw new LedgerLookupError(`No anchor health ledger exists on or before ${date}`, 'NOT_FOUND');
  }

  const ledger = await fetchLedgerAtCommit(commit);
  return {
    version: ledgerVersion(ledger),
    requestedDate: date,
    source: 'git-history',
    commit,
    ledger,
  };
}
