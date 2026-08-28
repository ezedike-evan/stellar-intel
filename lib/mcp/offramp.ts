/**
 * lib/mcp/offramp.ts
 *
 * Shared core for the MCP off-ramp tools (issues #135 / #136 / #819):
 *   - getQuote:      best net-received quote for a corridor + amount (#135)
 *   - prepareIntent: unsigned envelope + unsigned tx for agent signing (#136)
 *   - executeIntent: verifies + submits an agent-signed intent (#819)
 *
 * The logic mirrors the existing HTTP route (app/api/intent/offramp/route.ts)
 * and reuses the canonical hashing in lib/intent/hash.ts so the MCP surface and
 * the web app stay consistent. Kept framework-free (no MCP SDK imports here) so
 * it is trivially unit-testable and reusable by the server in scripts/mcp.
 */
import { z } from 'zod';
import { hashIntent, type Intent } from '@/lib/intent/hash';
import { USDC_ISSUER, HORIZON_URL } from '@/lib/config';
import { STELLAR_PUBKEY_PATTERN, AMOUNT_7DP_PATTERN } from '@/lib/patterns';
import { fetchCorridorRates } from '@/lib/stellar/server-rates';

// ─── Anchor routing table (corridor → anchor) ────────────────────────────────
// Mirrors app/api/intent/offramp/route.ts. Each corridor maps to the anchor we
// route through plus its on-chain receiving account. Pricing is live (see
// fetchCorridorRates below) — this table only pins which anchor account a
// corridor pays out to.

interface AnchorRoute {
  anchorId: string;
  anchorDomain: string;
  anchorAccount: string;
}

export const ANCHOR_ROUTING: Record<string, AnchorRoute> = {
  'usdc-ngn': {
    anchorId: 'cowrie',
    anchorDomain: 'cowrie.exchange',
    anchorAccount: 'GAIJ3VXNY7RPPLGVVCLGBK7NPHLL5ZRKATHETOA7M7UPZPAAHEGQQIY2',
  },
  'usdc-kes': {
    anchorId: 'flutterwave',
    anchorDomain: 'flutterwave.com',
    anchorAccount: 'GC6PVZIZYHHROHYBBOZDJ5ZZI4RH6LDSHRT4K7BA5QGZFKMZ6HAZUQAK',
  },
};

// ─── Schemas ──────────────────────────────────────────────────────────────────

/** Input schema for intel.offramp.quote (#135). */
export const QuoteInputSchema = z.object({
  from: z.string().min(1, 'from asset is required'),
  to: z.string().min(1, 'to currency is required'),
  amount: z
    .string()
    .regex(AMOUNT_7DP_PATTERN, 'amount must be a positive decimal (≤7 dp)')
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
  amount: z.string().regex(AMOUNT_7DP_PATTERN, 'amount must be a positive decimal (≤7 dp)'),
  sender: z.string().regex(STELLAR_PUBKEY_PATTERN, 'sender must be a Stellar public key'),
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
    public readonly code:
      | 'NO_ROUTE'
      | 'TX_BUILD_FAILED'
      | 'RATE_UNAVAILABLE'
      | 'INTENT_HASH_MISMATCH'
      | 'SIGNATURE_INVALID'
      | 'TX_MISMATCH'
      | 'UNSIGNED_TX'
      | 'SUBMIT_FAILED'
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

/** Render a live-rate float as a trimmed decimal string (max 7dp). */
function formatNetReceived(value: number): string {
  return value.toFixed(7).replace(/\.?0+$/, '');
}

/**
 * Build an unsigned Stellar payment tx to the anchor (XDR base64).
 *
 * Dynamic import: @stellar/stellar-sdk ships ESM-flavored types that TS's
 * Node16 resolution (used by the standalone packages/mcp build) refuses to
 * `require()`-import statically — see packages/publisher/src/batch.ts for the
 * same workaround. The package itself is dual CJS/ESM at runtime.
 */
export async function buildUnsignedOfframpTx(
  senderPublicKey: string,
  anchorAccount: string,
  amount: string,
  assetCode: string,
  assetIssuer: string,
  quoteId: string
): Promise<string> {
  const { Asset, Networks, TransactionBuilder, Operation, Memo, BASE_FEE, Account } =
    await import('@stellar/stellar-sdk');
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
 * Returns the live net-received quote for a corridor + amount, sourced from
 * the routed anchor's own current rate (SEP-38 firm quote, falling back to
 * SEP-24/SEP-6 fee-adjusted live FX — see fetchCorridorRates).
 * Throws {@link OfframpToolError} with code NO_ROUTE for unknown corridors,
 * or RATE_UNAVAILABLE when the routed anchor can't currently be quoted.
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

  const { rates, errors } = await fetchCorridorRates(id, parsed.amount);
  const anchorRate = rates.find((r) => r.anchorId === route.anchorId);
  if (!anchorRate || anchorRate.totalReceived == null) {
    const reason = errors.find((e) => e.anchorId === route.anchorId)?.reason;
    throw new OfframpToolError(
      `No live rate available for ${route.anchorId} on ${id}${reason ? `: ${reason}` : ''}`,
      'RATE_UNAVAILABLE'
    );
  }
  const netReceived = formatNetReceived(anchorRate.totalReceived);

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
    unsignedTx = await buildUnsignedOfframpTx(
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

// ─── Tool: intel.execute (#819) ──────────────────────────────────────────────
//
// Carries a prepared intent through to signed execution. Stellar Intel never
// signs anything here — the agent signs the intent hash (an attestation of
// consent) and the Stellar transaction itself with its own wallet, entirely
// outside this process; this tool only verifies the signed transaction still
// matches the intent it was prepared for and submits it to Horizon.

/** Input schema for intel.execute: a prepared envelope plus the agent's own signatures. */
export const ExecuteInputSchema = z.object({
  /** The exact envelope returned by intel.offramp.prepare. */
  unsignedEnvelope: UnsignedEnvelopeSchema,
  /**
   * Base64 ed25519 signature over `unsignedEnvelope.intentHash` (as UTF-8 bytes),
   * produced by the intent's `sender` key — an off-chain attestation that the
   * agent authorised this exact intent.
   */
  signature: z.string().min(1),
  /**
   * Base64 XDR of the `unsignedTx` from intel.offramp.prepare, signed by the
   * sender's own wallet. This is the transaction submitted to Horizon.
   */
  signedTx: z.string().min(1),
});
export type ExecuteInput = z.infer<typeof ExecuteInputSchema>;

/** Output schema for intel.execute: the Horizon submission result. */
export const ExecuteOutputSchema = z.object({
  status: z.literal('submitted'),
  hash: z.string(),
  ledger: z.number(),
  corridorId: z.string(),
  anchorId: z.string(),
});
export type ExecuteOutput = z.infer<typeof ExecuteOutputSchema>;

/**
 * Verifies a signed intent + transaction against the corridor route it was
 * prepared for, then submits the transaction to Horizon. Throws
 * {@link OfframpToolError} for any mismatch between the signed material and
 * the intent it claims to execute, or if Horizon rejects the submission.
 */
export async function executeIntent(input: ExecuteInput): Promise<ExecuteOutput> {
  const parsed = ExecuteInputSchema.parse(input);
  const { intent, intentHash } = parsed.unsignedEnvelope;

  const recomputedHash = await hashIntent(intent as unknown as Intent);
  if (recomputedHash !== intentHash) {
    throw new OfframpToolError(
      'intentHash does not match the intent payload',
      'INTENT_HASH_MISMATCH'
    );
  }

  const id = corridorId(intent.sourceAsset, intent.destinationAsset);
  const route = ANCHOR_ROUTING[id];
  if (!route) {
    throw new OfframpToolError(`No route for corridor ${id}`, 'NO_ROUTE');
  }

  const { Keypair, TransactionBuilder, Networks, Horizon } = await import('@stellar/stellar-sdk');

  let senderKey: InstanceType<typeof Keypair>;
  try {
    senderKey = Keypair.fromPublicKey(intent.sender);
  } catch {
    throw new OfframpToolError('sender is not a valid Stellar public key', 'SIGNATURE_INVALID');
  }

  let signatureValid: boolean;
  try {
    signatureValid = senderKey.verify(
      Buffer.from(intentHash, 'utf8'),
      Buffer.from(parsed.signature, 'base64')
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    throw new OfframpToolError(
      'Signature does not verify against the intent hash and sender key',
      'SIGNATURE_INVALID'
    );
  }

  let tx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    tx = TransactionBuilder.fromXDR(parsed.signedTx, Networks.PUBLIC);
  } catch {
    throw new OfframpToolError('signedTx is not a valid Stellar transaction XDR', 'TX_MISMATCH');
  }

  if ('signatures' in tx && tx.signatures.length === 0) {
    throw new OfframpToolError('signedTx carries no signatures', 'UNSIGNED_TX');
  }
  if (!('source' in tx) || tx.source !== intent.sender) {
    throw new OfframpToolError(
      'Transaction source account does not match intent.sender',
      'TX_MISMATCH'
    );
  }
  if (!('operations' in tx)) {
    throw new OfframpToolError('signedTx has no operations', 'TX_MISMATCH');
  }

  const [operation, ...rest] = tx.operations;
  const payment = operation as
    | {
        type: string;
        destination?: string;
        amount?: string;
        asset?: { code: string; issuer: string };
      }
    | undefined;
  // Amount comes back from XDR normalized to Stellar's fixed 7dp representation
  // (e.g. "100" -> "100.0000000"), so compare numerically rather than as strings.
  if (
    rest.length > 0 ||
    !payment ||
    payment.type !== 'payment' ||
    payment.destination !== route.anchorAccount ||
    payment.amount === undefined ||
    Number(payment.amount) !== Number(intent.amount) ||
    payment.asset?.code !== intent.sourceAsset ||
    payment.asset?.issuer !== USDC_ISSUER
  ) {
    throw new OfframpToolError('Transaction operations do not match the intent', 'TX_MISMATCH');
  }

  const expectedMemo = Buffer.from(intentHash, 'hex');
  const memo = ('memo' in tx ? tx.memo : undefined) as
    | { type: string; value?: Buffer | string }
    | undefined;
  if (memo?.type !== 'hash' || !Buffer.isBuffer(memo.value) || !memo.value.equals(expectedMemo)) {
    throw new OfframpToolError('Transaction memo does not match the intent hash', 'TX_MISMATCH');
  }

  const server = new Horizon.Server(HORIZON_URL);
  try {
    const result = await server.submitTransaction(tx);
    return ExecuteOutputSchema.parse({
      status: 'submitted',
      hash: result.hash,
      ledger: result.ledger,
      corridorId: id,
      anchorId: route.anchorId,
    });
  } catch (err) {
    const horizonErr = err as {
      response?: { data?: { extras?: { result_codes?: Record<string, string[]> } } };
    };
    const codes = horizonErr?.response?.data?.extras?.result_codes;
    const detail = codes
      ? Object.entries(codes)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join(' | ')
      : err instanceof Error
        ? err.message
        : 'Unknown Horizon error';
    throw new OfframpToolError(`Transaction submission failed: ${detail}`, 'SUBMIT_FAILED');
  }
}
