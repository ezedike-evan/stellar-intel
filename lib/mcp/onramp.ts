/**
 * lib/mcp/onramp.ts
 *
 * Shared core for the MCP on-ramp tools (issues #1486 / ONR025 / ONR028):
 *   - getOnrampQuote:      best indicative deposit estimate for a corridor + amount
 *   - prepareOnrampIntent: unsigned on-ramp intent + hash, and the app handoff URL
 *
 * Failures a caller can act on are thrown as `OnrampToolError`; `fromOnrampError`
 * (lib/mcp/errors.ts) maps them onto the MCP error taxonomy.
 *
 * There is deliberately no execute counterpart. A SEP-24 deposit starts with a
 * SEP-10 login signed by the user's own wallet, and the fiat leg is paid by the
 * user to the anchor, so an agent can quote and prepare but never complete a
 * deposit. Kept framework-free (no MCP SDK imports) so it is unit-testable.
 */
import { z } from 'zod';
import { CORRIDORS } from '@/constants';
import { createOnrampIntent, type OnrampIntentDeps } from '@/lib/intent/onramp';
import { OnrampIntentSchema } from '@/lib/intent/onramp-schema';
import { AMOUNT_PATTERN } from '@/lib/patterns';
import {
  fetchDepositRates,
  InvalidDepositAmountError,
  NoDepositRateError,
} from '@/lib/stellar/deposit-rates';
import { badInput, upstreamTimeout } from '@/lib/mcp/errors';

const SITE_URL = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://stellar-intel.vercel.app';

/**
 * How long an agent should treat a quote as current. Matches the `max-age` of the
 * public GET /api/v1/onramp/quote, and says nothing about the anchor's own rate.
 */
const ESTIMATE_TTL_MS = 15_000;

const PREPARE_NOTE =
  'Open handoffUrl in a browser to complete KYC and the deposit. Agents cannot complete this step.';

export type OnrampToolErrorCode =
  'NO_ROUTE' | 'RATE_UNAVAILABLE' | 'ACCOUNT_NOT_FOUND' | 'TX_BUILD_FAILED';

/** A route-level on-ramp failure. Map it with `fromOnrampError` before returning it to an agent. */
export class OnrampToolError extends Error {
  constructor(
    message: string,
    public readonly code: OnrampToolErrorCode
  ) {
    super(message);
    this.name = 'OnrampToolError';
  }
}

/** Most alternatives returned next to the best row. */
const MAX_ALTERNATIVES = 4;

// ─── Schemas ──────────────────────────────────────────────────────────────────

/** Input schema for intel.onramp.quote. */
export const OnrampQuoteInputSchema = z.object({
  sourceAsset: z.string().min(1, 'sourceAsset (fiat currency) is required'),
  destinationAsset: z.string().min(1, 'destinationAsset (Stellar asset code) is required'),
  amount: z
    .string()
    .regex(AMOUNT_PATTERN, 'amount must be a positive decimal string')
    .refine((v) => parseFloat(v) > 0, 'amount must be greater than zero'),
  /** Restrict the quote to one asset, as a SEP-38 identifier (`stellar:CODE:ISSUER`). */
  asset: z
    .string()
    .regex(
      /^stellar:(native|[A-Za-z0-9]{1,12}:G[A-Z2-7]{55})$/,
      'asset must be a SEP-38 identifier'
    )
    .optional(),
});
export type OnrampQuoteInput = z.infer<typeof OnrampQuoteInputSchema>;

const OnrampQuoteRowSchema = z.object({
  anchor: z.string(),
  anchorName: z.string(),
  /** SEP-38 identifier of the credited asset, e.g. `stellar:USDC:G…`. */
  asset: z.string(),
  /** Asset units credited for `fiatAmount`, net of the anchor's fees. */
  estimatedReceived: z.string(),
  /** Asset units credited per 1 unit of fiat, net of fees. */
  exchangeRate: z.string(),
  /** Flat fee in asset units; null when the anchor publishes none. */
  fee: z.string().nullable(),
});

/** Output schema for intel.onramp.quote. */
export const OnrampQuoteOutputSchema = OnrampQuoteRowSchema.extend({
  corridorId: z.string(),
  fiatAmount: z.string(),
  /** Always true: the firm conversion is set by the anchor inside its deposit flow. */
  indicative: z.literal(true),
  /** `sep38` when a quote server priced it, `sep24-fee` when built from published fees. */
  source: z.enum(['sep38', 'sep24-fee']),
  alternatives: z.array(OnrampQuoteRowSchema),
  /** ISO time after which to re-fetch: estimates move, and this one is never firm. */
  expiresAt: z.string(),
});
export type OnrampQuoteOutput = z.infer<typeof OnrampQuoteOutputSchema>;

/** Output schema for intel.onramp.prepare. */
export const OnrampPrepareOutputSchema = z.object({
  unsignedEnvelope: z.object({
    intent: OnrampIntentSchema,
    /** Hex SHA-256 of the canonicalized intent. */
    intentHash: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  corridorId: z.string(),
  /** Base64 changeTrust transaction to sign, or null when the wallet already has the trustline. */
  unsignedChangeTrustXdr: z.string().nullable(),
  /** Absolute URL where the user completes the deposit with their own wallet and the anchor. */
  handoffUrl: z.string().url(),
  note: z.string(),
});
export type OnrampPrepareOutput = z.infer<typeof OnrampPrepareOutputSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The corridor that pays fiat `from` in for on-chain asset `to`, or a BAD_INPUT error. */
function resolveCorridorId(fiat: string, asset: string): string {
  const corridor = CORRIDORS.find((c) => c.to === fiat && c.from === asset);
  if (!corridor) {
    throw new OnrampToolError(`No on-ramp corridor for ${fiat} → ${asset}`, 'NO_ROUTE');
  }
  return corridor.id;
}

function formatUnits(value: number): string {
  return value.toFixed(7).replace(/\.?0+$/, '') || '0';
}

// ─── Tools ────────────────────────────────────────────────────────────────────

/**
 * Best indicative deposit estimate across the anchors that serve the corridor.
 * Rows are already sorted by credited amount; anchors that could not be priced
 * are skipped, and the call fails only when none could.
 */
export async function getOnrampQuote(
  input: OnrampQuoteInput,
  now: Date = new Date()
): Promise<OnrampQuoteOutput> {
  const parsed = OnrampQuoteInputSchema.safeParse(input);
  if (!parsed.success) throw badInput(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { sourceAsset, destinationAsset, amount, asset } = parsed.data;

  const corridorId = resolveCorridorId(sourceAsset, destinationAsset);

  let comparison;
  try {
    comparison = await (asset
      ? fetchDepositRates(corridorId, amount, { asset })
      : fetchDepositRates(corridorId, amount));
  } catch (err) {
    if (err instanceof InvalidDepositAmountError) throw badInput(err.message, 'INVALID_AMOUNT');
    if (err instanceof NoDepositRateError) {
      throw new OnrampToolError(err.message, 'RATE_UNAVAILABLE');
    }
    throw upstreamTimeout(err instanceof Error ? err.message : 'Unknown error', 'UNKNOWN_ERROR');
  }

  const priced = comparison.rates.filter(
    (r) => r.source !== 'unavailable' && r.totalReceived !== null && r.exchangeRate !== null
  );
  const [best, ...rest] = priced;
  if (!best) {
    const detail = comparison.errors.map((e) => `${e.anchorId}: ${e.reason}`).join('; ');
    throw new OnrampToolError(
      `No anchor could price ${sourceAsset} → ${destinationAsset}${detail ? ` (${detail})` : ''}`,
      'RATE_UNAVAILABLE'
    );
  }

  const row = (r: typeof best) => ({
    anchor: r.anchorId,
    anchorName: r.anchorName,
    asset: r.asset,
    estimatedReceived: formatUnits(r.totalReceived!),
    exchangeRate: formatUnits(r.exchangeRate!),
    fee: r.fee === null ? null : formatUnits(r.fee),
  });

  return OnrampQuoteOutputSchema.parse({
    ...row(best),
    corridorId,
    fiatAmount: amount,
    indicative: true,
    source: best.source,
    alternatives: rest.slice(0, MAX_ALTERNATIVES).map(row),
    expiresAt: new Date(now.getTime() + ESTIMATE_TTL_MS).toISOString(),
  });
}

/**
 * Validates an on-ramp intent and resolves it through `createOnrampIntent`: the
 * best anchor, the intent hash, and an unsigned changeTrust when the destination
 * lacks the trustline. Returns the unsigned envelope together with an absolute
 * URL where the user finishes the deposit. Nothing is submitted and no anchor
 * session is opened: the SEP-10 login that starts a deposit has to be signed by
 * the user's own wallet, in a browser.
 */
export async function prepareOnrampIntent(
  input: unknown,
  deps?: OnrampIntentDeps
): Promise<OnrampPrepareOutput> {
  const parsed = OnrampIntentSchema.safeParse(input);
  if (!parsed.success) throw badInput(parsed.error.issues[0]?.message ?? 'Invalid intent');
  const intent = parsed.data;

  const result = await createOnrampIntent(intent, deps);
  if (!result.ok) {
    // Only the codes an agent can act on are passed through; a Horizon outage
    // while checking the wallet is transient, like any other upstream failure.
    if (result.code === 'PREFLIGHT_FAILED') throw upstreamTimeout(result.message, result.code);
    throw new OnrampToolError(result.message, result.code);
  }
  const { route, intentHash, handoffUrl, unsignedChangeTrustXdr } = result.response;

  return OnrampPrepareOutputSchema.parse({
    unsignedEnvelope: { intent, intentHash },
    corridorId: route.corridorId,
    unsignedChangeTrustXdr,
    handoffUrl: new URL(handoffUrl, SITE_URL).toString(),
    note: PREPARE_NOTE,
  });
}
