export type FlagName =
  | 'intentFlow'
  | 'reputationWrites'
  | 'mcpAdvertisement'
  | 'v11Corridors'
  | 'recurringIntents'
  | 'requireKeyForWrites'
  | 'intentTemplates'
  | 'firmQuoteBonus'
  | 'disputeLadder'
  | 'refundGuarantees'
  | 'executionSla'
  | 'slippageBreaches';

export const flags: Record<FlagName, boolean> = {
  // Default to enabled unless explicitly set to 'off'
  intentFlow: (process.env.NEXT_PUBLIC_INTENT_FLOW || 'on') !== 'off',
  reputationWrites: (process.env.NEXT_PUBLIC_REPUTATION_WRITES || 'on') !== 'off',
  mcpAdvertisement: (process.env.NEXT_PUBLIC_MCP_ADVERTISE || 'on') !== 'off',
  // v1.1 target corridors (ZAR, XOF). Default OFF until anchors are onboarded —
  // opt in with NEXT_PUBLIC_V11_CORRIDORS=on. Even when on, a corridor stays
  // hidden until at least one anchor serves it (see VISIBLE_CORRIDORS).
  v11Corridors: (process.env.NEXT_PUBLIC_V11_CORRIDORS || 'off') === 'on',
  // Recurring intents: sign-once execution engine. Default OFF — gated behind
  // the signed-intent flow. Opt in with NEXT_PUBLIC_RECURRING_INTENTS=on.
  recurringIntents: (process.env.NEXT_PUBLIC_RECURRING_INTENTS || 'off') === 'on',
  // Require an API key for writes (intents, reputation, disputes). Default OFF —
  // anonymous callers keep writes. Opt in with NEXT_PUBLIC_REQUIRE_KEY_FOR_WRITES=on.
  requireKeyForWrites: (process.env.NEXT_PUBLIC_REQUIRE_KEY_FOR_WRITES || 'off') === 'on',
  // Per-corridor intent templates, saved in the browser per wallet. Default OFF.
  intentTemplates: (process.env.NEXT_PUBLIC_INTENT_TEMPLATES || 'off') === 'on',
  // Ranking bonus for firm (SEP-38) quotes over estimates of nearly the same size.
  // Default OFF; opt in with NEXT_PUBLIC_FIRM_QUOTE_BONUS=on. It reorders rows and
  // never changes a displayed amount.
  firmQuoteBonus: (process.env.NEXT_PUBLIC_FIRM_QUOTE_BONUS || 'off') === 'on',
  // Dispute escalation ladder: multi-level dispute management and status reporting.
  // Default OFF until ladder is staffed. Opt in with NEXT_PUBLIC_DISPUTE_LADDER=on.
  disputeLadder: (process.env.NEXT_PUBLIC_DISPUTE_LADDER || 'off') === 'on',
  // Refund guarantees: sign refund acknowledgements on status screens.
  // Default OFF; opt in with NEXT_PUBLIC_REFUND_GUARANTEES=on.
  refundGuarantees: (process.env.NEXT_PUBLIC_REFUND_GUARANTEES || 'off') === 'on',
  // Execution SLA card on the anchor page. Default OFF until anchors have settlement volume.
  executionSla: (process.env.NEXT_PUBLIC_EXECUTION_SLA || 'off') === 'on',
  // Below-minimum notice on the off-ramp status view when a completed withdrawal
  // settles under the signed minReceive floor. Default OFF; opt in with
  // NEXT_PUBLIC_SLIPPAGE_BREACHES=on.
  slippageBreaches: (process.env.NEXT_PUBLIC_SLIPPAGE_BREACHES || 'off') === 'on',
};

export function isFlag(name: FlagName) {
  return flags[name];
}

export default { flags, isFlag };

/**
 * Build-time feature flags.
 *
 * `NEXT_PUBLIC_INTENT_FLOW` gates the signed-intent off-ramp path. It is OFF by
 * default and only enabled when explicitly set to `'true'` — the semantics the
 * live consumer (`components/offramp/ExecuteDrawer.tsx`) depends on.
 */
export const FLAGS = {
  INTENT_FLOW: process.env.NEXT_PUBLIC_INTENT_FLOW === 'true',
};
