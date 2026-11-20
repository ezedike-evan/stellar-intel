import { hashIntent } from '@/lib/intent/hash';
import type { OnrampIntent } from '@/lib/intent/onramp-schema';
import { getAnchorById, getAnchorsByCorridorId, isValidCorridorId } from '@/lib/stellar/anchors';
import { fetchDepositRates, type DepositFundingType } from '@/lib/stellar/deposit-rates';
import { buildChangeTrustTx, checkDepositPreflight } from '@/lib/stellar/horizon';

/**
 * lib/intent/onramp.ts
 *
 * The on-ramp intent core, the deposit counterpart of `createOfframpIntent`.
 * Nothing is paid on-chain up front: the output is a routed anchor, the intent
 * hash, a handoff URL into the browser-only interactive deposit, and an unsigned
 * changeTrust transaction when the destination has no trustline yet. The API
 * never opens an anchor session, because KYC and the SEP-24 window need a browser.
 */

export interface OnrampRoute {
  anchorId: string;
  anchorDomain: string;
  corridorId: string;
  /** SEP-38 identifier of the asset the destination is credited with. */
  asset: string;
  /** In units of the credited asset; "0" when the anchor publishes no flat fee. */
  estimatedFee: string;
  estimatedReceived: string;
  indicative: true;
}

export interface OnrampIntentResponse {
  route: OnrampRoute;
  intentHash: string;
  /** Relative path into the /onramp page, which runs the interactive deposit. */
  handoffUrl: string;
  /** Base64 changeTrust XDR to sign, or null when no trustline step is needed. */
  unsignedChangeTrustXdr: string | null;
}

export type OnrampErrorCode =
  'NO_ROUTE' | 'RATE_UNAVAILABLE' | 'ACCOUNT_NOT_FOUND' | 'PREFLIGHT_FAILED' | 'TX_BUILD_FAILED';

export type OnrampResult =
  | { ok: true; response: OnrampIntentResponse }
  | { ok: false; code: OnrampErrorCode; message: string; status: number };

/** Network dependencies, injectable so tests run without Horizon or anchors. */
export interface OnrampIntentDeps {
  fetchDepositRates?: typeof fetchDepositRates;
  checkDepositPreflight?: typeof checkDepositPreflight;
  buildChangeTrustTx?: typeof buildChangeTrustTx;
}

/** The intent's deposit method in SEP-24 funding terms. Fees do not vary by method today. */
const FUNDING_TYPE: Record<OnrampIntent['depositMethod'], DepositFundingType> = {
  bank_transfer: 'bank_account',
  card: 'bank_account',
  cash: 'cash',
  mobile_money: 'mobile_money',
};

function fail(code: OnrampErrorCode, message: string, status: number): OnrampResult {
  return { ok: false, code, message, status };
}

/** Splits a SEP-38 `stellar:CODE:ISSUER` (or `stellar:native`) identifier. */
function parseStellarAsset(sep38: string): { code: string; issuer: string } | null {
  if (sep38 === 'stellar:native') return { code: 'XLM', issuer: '' };
  const [scheme, code, issuer] = sep38.split(':');
  if (scheme !== 'stellar' || !code || !issuer) return null;
  return { code, issuer };
}

/**
 * Resolves a validated on-ramp intent into a route, hash, handoff URL and, when
 * needed, an unsigned changeTrust. Deterministic in the intent for the hash and
 * handoff; the route reflects the best indicative rate at call time.
 */
export async function createOnrampIntent(
  intent: OnrampIntent,
  deps: OnrampIntentDeps = {}
): Promise<OnrampResult> {
  const getRates = deps.fetchDepositRates ?? fetchDepositRates;
  const preflight = deps.checkDepositPreflight ?? checkDepositPreflight;
  const buildTrust = deps.buildChangeTrustTx ?? buildChangeTrustTx;

  const corridorId = `${intent.destinationAsset}-${intent.sourceAsset}`.toLowerCase();
  if (!isValidCorridorId(corridorId) || getAnchorsByCorridorId(corridorId).length === 0) {
    return fail(
      'NO_ROUTE',
      `No route found for ${intent.sourceAsset} → ${intent.destinationAsset}`,
      404
    );
  }

  let best;
  try {
    const comparison = await getRates(corridorId, intent.amount, {
      type: FUNDING_TYPE[intent.depositMethod],
    });
    best = comparison.rates.find(
      (r) => r.anchorId === comparison.bestRateId && r.totalReceived !== null
    );
  } catch {
    best = undefined;
  }
  if (!best || best.totalReceived === null) {
    return fail(
      'RATE_UNAVAILABLE',
      `No deposit rate is available for ${corridorId} right now`,
      503
    );
  }

  const asset = parseStellarAsset(best.asset);
  if (!asset) {
    return fail('RATE_UNAVAILABLE', `Anchor returned an unusable asset "${best.asset}"`, 503);
  }

  let state;
  try {
    state = await preflight(intent.destination, asset);
  } catch {
    return fail('PREFLIGHT_FAILED', 'Could not check the destination account on Stellar', 502);
  }
  if (!state.accountExists) {
    return fail(
      'ACCOUNT_NOT_FOUND',
      'The destination account does not exist on Stellar. Fund it with XLM first.',
      422
    );
  }

  let unsignedChangeTrustXdr: string | null = null;
  if (!state.hasTrustline) {
    try {
      const tx = await buildTrust({
        sourcePublicKey: intent.destination,
        assetCode: asset.code,
        assetIssuer: asset.issuer,
      });
      unsignedChangeTrustXdr = tx.toXDR();
    } catch (err) {
      return fail(
        'TX_BUILD_FAILED',
        err instanceof Error ? err.message : 'Failed to build the trustline transaction',
        500
      );
    }
  }

  const anchor = getAnchorById(best.anchorId);
  const handoff = new URLSearchParams({
    corridor: corridorId,
    amount: intent.amount,
    anchor: best.anchorId,
  });

  return {
    ok: true,
    response: {
      route: {
        anchorId: best.anchorId,
        anchorDomain: anchor.serviceDomain ?? anchor.homeDomain,
        corridorId,
        asset: best.asset,
        estimatedFee: String(best.fee ?? 0),
        estimatedReceived: String(best.totalReceived),
        indicative: true,
      },
      intentHash: await hashIntent(intent),
      handoffUrl: `/onramp?${handoff.toString()}`,
      unsignedChangeTrustXdr,
    },
  };
}
