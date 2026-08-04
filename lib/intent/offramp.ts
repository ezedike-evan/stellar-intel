import {
  Asset,
  TransactionBuilder,
  Operation,
  Memo,
  BASE_FEE,
  Account,
} from '@stellar/stellar-sdk';
import { z } from 'zod';
import { hashIntent, type Intent } from '@/lib/intent/hash';
import { NETWORK_PASSPHRASE, USDC_ISSUER } from '@/lib/config';
import { AMOUNT_PATTERN } from '@/lib/patterns';
import {
  registeredAnchorsForCorridor,
  routingTargetsForCorridor,
} from '@/lib/intent/anchor-accounts';
import { selectAnchor } from '@/lib/intent/routing';

/**
 * lib/intent/offramp.ts
 *
 * The off-ramp intent core — anchor routing and unsigned-transaction assembly —
 * extracted from the route handler so the internal (`/api/intent/offramp`) and
 * the public v1 (`/api/v1/intent/offramp`) surfaces share one implementation.
 */

export const IntentSchema = z.object({
  type: z.literal('offramp'),
  sourceAsset: z.string().min(1),
  destinationAsset: z.string().min(1),
  amount: z.string().regex(AMOUNT_PATTERN, 'amount must be a positive decimal string'),
  sender: z.string().min(1),
  recipient: z.string().min(1),
});

export interface OfframpRoute {
  anchorId: string;
  anchorDomain: string;
  corridorId: string;
  estimatedFee: string;
  estimatedReceived: string;
}

export interface OfframpIntentResponse {
  route: OfframpRoute;
  unsignedTx: string;
  quoteId: string;
}

export function resolveRoute(sourceAsset: string, destinationAsset: string): OfframpRoute | null {
  const corridorId = `${sourceAsset.toLowerCase()}-${destinationAsset.toLowerCase()}`;
  const target = routingTargetsForCorridor(corridorId)[0];
  if (!target) return null;
  return {
    anchorId: target.anchorId,
    anchorDomain: target.anchorDomain,
    corridorId,
    estimatedFee: '2',
    estimatedReceived: '0',
  };
}

function buildUnsignedOfframpTx(
  senderPublicKey: string,
  anchorAccount: string,
  amount: string,
  assetCode: string,
  assetIssuer: string,
  quoteId: string
): string {
  const asset = new Asset(assetCode, assetIssuer);
  const account = new Account(senderPublicKey, '0');

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    // Was hardcoded to Networks.PUBLIC, so a testnet deployment still handed
    // callers mainnet transactions to sign (#941).
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.payment({ destination: anchorAccount, asset, amount }))
    .addMemo(Memo.hash(Buffer.from(quoteId, 'hex')))
    .setTimeout(300)
    .build();

  return tx.toXDR();
}

export type OfframpErrorCode = 'NO_ROUTE' | 'TX_BUILD_FAILED';

export type OfframpResult =
  | { ok: true; response: OfframpIntentResponse }
  | { ok: false; code: OfframpErrorCode; message: string; status: number };

/**
 * Resolves a validated off-ramp intent into a route + unsigned transaction, or
 * a typed error. Deterministic in the sender + intent, so the same intent
 * always yields the same `quoteId` — the basis for idempotent retries.
 */
export async function createOfframpIntent(intent: Intent): Promise<OfframpResult> {
  const corridorId = `${intent.sourceAsset.toLowerCase()}-${intent.destinationAsset.toLowerCase()}`;

  // Scored routing when ROUTING_STRATEGY says so, first-match otherwise (#790).
  const decision = await selectAnchor(corridorId, intent.amount);
  const anchorEntry = decision?.target;
  const route: OfframpRoute | null = anchorEntry
    ? {
        anchorId: anchorEntry.anchorId,
        anchorDomain: anchorEntry.anchorDomain,
        corridorId,
        estimatedFee: '2',
        estimatedReceived: '0',
      }
    : null;

  if (!route || !anchorEntry) {
    // Distinguish "we do not serve this corridor" from "we serve it but have no
    // verified payment account". The second is a configuration gap on our side,
    // and it used to be papered over with an address that did not exist (#941).
    const registered = registeredAnchorsForCorridor(corridorId);
    const message =
      registered.length > 0
        ? `No payment account configured for ${corridorId}. Registered anchors: ${registered.join(', ')}. Set ANCHOR_PAYMENT_ACCOUNTS.`
        : `No route found for ${intent.sourceAsset} → ${intent.destinationAsset}`;

    return { ok: false, code: 'NO_ROUTE', message, status: 400 };
  }

  const quoteId = await hashIntent(intent);
  try {
    const unsignedTx = buildUnsignedOfframpTx(
      intent.sender,
      anchorEntry.anchorAccount,
      intent.amount,
      intent.sourceAsset,
      USDC_ISSUER,
      quoteId
    );
    return { ok: true, response: { route, unsignedTx, quoteId } };
  } catch (err) {
    return {
      ok: false,
      code: 'TX_BUILD_FAILED',
      message: err instanceof Error ? err.message : 'Failed to build transaction',
      status: 500,
    };
  }
}
