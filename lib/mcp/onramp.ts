/**
 * lib/mcp/onramp.ts
 *
 * Shared core for the MCP on-ramp tools (issues #1486 / ONR025 / ONR028):
 *   - getOnrampQuote:      best indicative deposit estimate for a corridor + amount
 *   - prepareOnrampIntent: unsigned on-ramp intent + hash, and the app handoff URL
 *
 * There is deliberately no execute counterpart. A SEP-24 deposit starts with a
 * SEP-10 login signed by the user's own wallet, and the fiat leg is paid by the
 * user to the anchor, so an agent can quote and prepare but never complete a
 * deposit. Kept framework-free (no MCP SDK imports) so it is unit-testable.
 */
import { z } from 'zod';
import { CORRIDORS } from '@/constants';
import { hashIntent, type Intent } from '@/lib/intent/hash';
import { OnrampIntentSchema } from '@/lib/intent/onramp-schema';
import { AMOUNT_PATTERN } from '@/lib/patterns';
import {
  fetchDepositRates,
  InvalidDepositAmountError,
  NoDepositRateError,
} from '@/lib/stellar/deposit-rates';
import { anchorUnavailable, badInput, upstreamTimeout } from '@/lib/mcp/errors';

const SITE_URL = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://stellar-intel.vercel.app';

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
  /** Where the user completes the deposit with their own wallet and the anchor. */
  handoffUrl: z.string().url(),
  nextStep: z.string(),
});
export type OnrampPrepareOutput = z.infer<typeof OnrampPrepareOutputSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The corridor that pays fiat `from` in for on-chain asset `to`, or a BAD_INPUT error. */
function resolveCorridorId(fiat: string, asset: string): string {
  const corridor = CORRIDORS.find((c) => c.to === fiat && c.from === asset);
  if (!corridor) {
    throw badInput(`No on-ramp corridor for ${fiat} → ${asset}`, 'NO_ROUTE');
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
export async function getOnrampQuote(input: OnrampQuoteInput): Promise<OnrampQuoteOutput> {
  const parsed = OnrampQuoteInputSchema.safeParse(input);
  if (!parsed.success) throw badInput(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { sourceAsset, destinationAsset, amount } = parsed.data;

  const corridorId = resolveCorridorId(sourceAsset, destinationAsset);

  let comparison;
  try {
    comparison = await fetchDepositRates(corridorId, amount);
  } catch (err) {
    if (err instanceof InvalidDepositAmountError) throw badInput(err.message, 'INVALID_AMOUNT');
    if (err instanceof NoDepositRateError) throw anchorUnavailable(err.message, 'RATE_UNAVAILABLE');
    throw upstreamTimeout(err instanceof Error ? err.message : 'Unknown error', 'UNKNOWN_ERROR');
  }

  const priced = comparison.rates.filter(
    (r) => r.source !== 'unavailable' && r.totalReceived !== null && r.exchangeRate !== null
  );
  const [best, ...rest] = priced;
  if (!best) {
    const detail = comparison.errors.map((e) => `${e.anchorId}: ${e.reason}`).join('; ');
    throw anchorUnavailable(
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
  });

  return OnrampQuoteOutputSchema.parse({
    ...row(best),
    corridorId,
    fiatAmount: amount,
    indicative: true,
    source: best.source,
    alternatives: rest.slice(0, MAX_ALTERNATIVES).map(row),
  });
}

/**
 * Validates an on-ramp intent, hashes it, and returns it unsigned together
 * with the app URL where the user finishes the deposit. Nothing is submitted
 * and no anchor is contacted: the SEP-10 login that opens a deposit has to be
 * signed by the user's own wallet.
 */
export async function prepareOnrampIntent(input: unknown): Promise<OnrampPrepareOutput> {
  const parsed = OnrampIntentSchema.safeParse(input);
  if (!parsed.success) throw badInput(parsed.error.issues[0]?.message ?? 'Invalid intent');
  const intent = parsed.data;

  const corridorId = resolveCorridorId(intent.sourceAsset, intent.destinationAsset);
  // The canonical hash only needs a plain object; `Intent` is typed for the
  // off-ramp shape, which an on-ramp intent (no `recipient`) deliberately lacks.
  const intentHash = await hashIntent(intent as unknown as Intent);

  const handoff = new URL('/onramp', SITE_URL);
  handoff.searchParams.set('corridor', corridorId);
  handoff.searchParams.set('amount', intent.amount);

  return OnrampPrepareOutputSchema.parse({
    unsignedEnvelope: { intent, intentHash },
    corridorId,
    handoffUrl: handoff.toString(),
    nextStep:
      'Open handoffUrl in a browser with the sender wallet connected. The user signs in to the ' +
      'anchor and pays the fiat themselves; Stellar Intel never holds keys or fiat.',
  });
}
