/**
 * lib/mcp/offramp.ts
 *
 * Shared core for the MCP off-ramp tools (issues #135 / #136):
 *   - getQuote:    best net-received quote for a corridor + amount (#135)
 *   - prepareIntent: unsigned envelope + unsigned tx for agent signing (#136)
 *
 * The logic mirrors the existing HTTP route (app/api/intent/offramp/route.ts)
 * and reuses the canonical hashing in lib/intent/hash.ts so the MCP surface and
 * the web app stay consistent. Kept framework-free (no MCP SDK imports here) so
 * it is trivially unit-testable and reusable by the server in scripts/mcp.
 */
import { z } from 'zod';
import {
  Asset,
  Networks,
  TransactionBuilder,
  Operation,
  Memo,
  BASE_FEE,
  Account,
} from '@stellar/stellar-sdk';
import { hashIntent, type Intent } from '@/lib/intent/hash';
import { USDC_ISSUER } from '@/lib/config';

// ─── Anchor routing table (corridor → anchor) ────────────────────────────────
// Mirrors app/api/intent/offramp/route.ts. Each corridor maps to the anchor we
// route through plus its on-chain receiving account.

interface AnchorRoute {
  anchorId: string;
  anchorDomain: string;
  anchorAccount: string;
  /** Flat fee in source asset units, as a decimal string. */
  flatFee: string;
  /** Local-currency units received per 1 source unit (after fee). */
  rate: string;
}

export const ANCHOR_ROUTING: Record<string, AnchorRoute> = {
  'usdc-ngn': {
    anchorId: 'cowrie',
    anchorDomain: 'cowrie.exchange',
    anchorAccount: 'GAIJ3VXNY7RPPLGVVCLGBK7NPHLL5ZRKATHETOA7M7UPZPAAHEGQQIY2',
    flatFee: '2',
    rate: '1600',
  },
  'usdc-kes': {
    anchorId: 'flutterwave',
    anchorDomain: 'flutterwave.com',
    anchorAccount: 'GC6PVZIZYHHROHYBBOZDJ5ZZI4RH6LDSHRT4K7BA5QGZFKMZ6HAZUQAK',
    flatFee: '1.5',
    rate: '129',
  },
};

// ─── Schemas ──────────────────────────────────────────────────────────────────

/** Input schema for intel.offramp.quote (#135). */
export const QuoteInputSchema = z.object({
  from: z.string().min(1, 'from asset is required'),
  to: z.string().min(1, 'to currency is required'),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/, 'amount must be a positive decimal (≤7 dp)')
    .refine((v) => parseFloat(v) > 0, 'amount must be greater than zero'),
});
export type QuoteInput = z.infer<typeof QuoteInputSchema>;

/** Output schema for intel.offramp.quote (#135). */
export const QuoteOutputSchema = z.object({
  anchor: z.string(),
  quoteId: z.string(),
  netReceived: z.string(),
  expiresAt: z.string(),
});
export type QuoteOutput = z.infer<typeof QuoteOutputSchema>;

/**
 * Input schema for intel.offramp.prepare (#136): an intent WITHOUT a signature.
 * Matches the `Intent` shape used by lib/intent/hash + the offramp HTTP route.
 */
export const PrepareInputSchema = z.object({
  type: z.literal('offramp'),
  sourceAsset: z.string().min(1),
  destinationAsset: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d{1,7})?$/, 'amount must be a positive decimal (≤7 dp)'),
  sender: z.string().regex(/^G[A-Z0-9]{55}$/, 'sender must be a Stellar public key'),
  recipient: z.string().min(1),
});
export type PrepareInput = z.infer<typeof PrepareInputSchema>;

/** The unsigned envelope an agent signs (intent + its canonical hash). */
export const UnsignedEnvelopeSchema = z.object({
  intent: PrepareInputSchema,
  /** Hex SHA-256 of the canonicalized intent — the message to sign. */
  intentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type UnsignedEnvelope = z.infer<typeof UnsignedEnvelopeSchema>;

/** Output schema for intel.offramp.prepare (#136). */
export const PrepareOutputSchema = z.object({
  unsignedEnvelope: UnsignedEnvelopeSchema,
  unsignedTx: z.string(),
});
export type PrepareOutput = z.infer<typeof PrepareOutputSchema>;

// ─── Errors ─────────────────────────────────────────────────────────────────

export class OfframpToolError extends Error {
  constructor(
    message: string,
    public readonly code: 'NO_ROUTE' | 'TX_BUILD_FAILED'
  ) {
    super(message);
    this.name = 'OfframpToolError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build the corridor id from a `from`/`to` pair, e.g. (USDC, NGN) → usdc-ngn. */
export function corridorId(from: string, to: string): string {
  return `${from.toLowerCase()}-${to.toLowerCase()}`;
}

/** Parse a decimal string into a BigInt scaled to 7 decimal places. */
function toScaled(s: string): bigint {
  const SCALE = 10_000_000n;
  const [int = '0', frac = ''] = s.split('.');
  return BigInt(int) * SCALE + BigInt(frac.slice(0, 7).padEnd(7, '0'));
}

/** Render a 7dp-scaled BigInt back to a trimmed decimal string. */
function fromScaled(value: bigint): string {
  const SCALE = 10_000_000n;
  const whole = value / SCALE;
  const frac = (value % SCALE).toString().padStart(7, '0').replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''}`;
}

/** Multiply two decimal strings to 7dp using BigInt (no float drift). */
function mulDecimal(a: string, b: string): string {
  const product = (toScaled(a) * toScaled(b)) / 10_000_000n;
  return fromScaled(product);
}

/** Subtract decimal strings to 7dp using BigInt, floored at zero. */
function subDecimal(a: string, b: string): string {
  let r = toScaled(a) - toScaled(b);
  if (r < 0n) r = 0n; // floor at zero — never report negative net received
  return fromScaled(r);
}

/** Build an unsigned Stellar payment tx to the anchor (XDR base64). */
export function buildUnsignedOfframpTx(
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
    networkPassphrase: Networks.PUBLIC,
  })
    .addOperation(Operation.payment({ destination: anchorAccount, asset, amount }))
    .addMemo(Memo.hash(Buffer.from(quoteId, 'hex')))
    .setTimeout(300)
    .build();
  return tx.toXDR();
}

// ─── Tool: intel.offramp.quote (#135) ────────────────────────────────────────

/** Quote validity window in seconds. */
export const QUOTE_TTL_SECONDS = 300;

/**
 * Returns the best net-received quote for a corridor + amount.
 * Throws {@link OfframpToolError} with code NO_ROUTE for unknown corridors.
 */
export async function getQuote(
  input: QuoteInput,
  now: () => number = Date.now
): Promise<QuoteOutput> {
  const parsed = QuoteInputSchema.parse(input);
  const id = corridorId(parsed.from, parsed.to);
  const route = ANCHOR_ROUTING[id];
  if (!route) {
    throw new OfframpToolError(`No route for corridor ${id}`, 'NO_ROUTE');
  }

  const afterFee = subDecimal(parsed.amount, route.flatFee);
  const netReceived = mulDecimal(afterFee, route.rate);

  // A deterministic quote id derived from the corridor + amount + anchor.
  const quoteId = await hashIntent({
    type: 'quote',
    sourceAsset: parsed.from,
    destinationAsset: parsed.to,
    amount: parsed.amount,
    sender: route.anchorId,
    recipient: route.anchorAccount,
  } as Intent);

  return QuoteOutputSchema.parse({
    anchor: route.anchorId,
    quoteId,
    netReceived,
    expiresAt: new Date(now() + QUOTE_TTL_SECONDS * 1000).toISOString(),
  });
}

// ─── Tool: intel.offramp.prepare (#136) ──────────────────────────────────────

/**
 * Returns an unsigned intent envelope plus an unsigned Stellar transaction so an
 * agent can sign both. The `intentHash` in the envelope is the canonical SHA-256
 * an agent signs to authorise the intent.
 */
export async function prepareIntent(input: PrepareInput): Promise<PrepareOutput> {
  const intent = PrepareInputSchema.parse(input);
  const id = corridorId(intent.sourceAsset, intent.destinationAsset);
  const route = ANCHOR_ROUTING[id];
  if (!route) {
    throw new OfframpToolError(`No route for corridor ${id}`, 'NO_ROUTE');
  }

  const intentHash = await hashIntent(intent as unknown as Intent);

  let unsignedTx: string;
  try {
    unsignedTx = buildUnsignedOfframpTx(
      intent.sender,
      route.anchorAccount,
      intent.amount,
      intent.sourceAsset,
      USDC_ISSUER,
      intentHash
    );
  } catch (err) {
    throw new OfframpToolError(
      err instanceof Error ? err.message : 'Failed to build transaction',
      'TX_BUILD_FAILED'
    );
  }

  return PrepareOutputSchema.parse({
    unsignedEnvelope: { intent, intentHash },
    unsignedTx,
  });
}
