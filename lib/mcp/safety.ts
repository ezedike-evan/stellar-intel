import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { compareDecimals } from '@/lib/decimal';
import { AMOUNT_PATTERN } from '@/lib/patterns';
import { getLogger } from '@/lib/logger';
import { badInput } from '@/lib/mcp/errors';

/**
 * Per-call amount caps for intents an agent can prepare or execute (AGS019).
 *
 * A runaway or prompt-injected agent must not be able to prepare or execute a
 * payment above the operator's limit: deployment-wide via
 * `MCP_MAX_INTENT_AMOUNT`, and tighter per API key via `maxIntentAmount`. The
 * cap is per call, in units of the intent's source amount. Cumulative or daily
 * spend limits are out of scope.
 */

let warnedInvalidEnv = false;

function isPositiveAmount(value: string): boolean {
  return AMOUNT_PATTERN.test(value) && compareDecimals(value, '0') > 0;
}

/** The deployment-wide cap from `MCP_MAX_INTENT_AMOUNT`, or null when unset or invalid. */
export function globalAmountCap(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env['MCP_MAX_INTENT_AMOUNT']?.trim();
  if (!raw) return null;
  if (isPositiveAmount(raw)) return raw;
  if (!warnedInvalidEnv) {
    warnedInvalidEnv = true;
    getLogger('mcp.safety').warn({
      event: 'mcp_max_intent_amount_invalid',
      message: 'MCP_MAX_INTENT_AMOUNT is set but is not a positive decimal; ignoring it',
    });
  }
  return null;
}

/** The lower of the caller's cap and the deployment cap, either alone, or null. */
export function effectiveAmountCap(
  callerCap: string | null | undefined,
  env?: NodeJS.ProcessEnv
): string | null {
  const global = globalAmountCap(env);
  const caller = callerCap && isPositiveAmount(callerCap) ? callerCap : null;
  if (caller === null) return global;
  if (global === null) return caller;
  return compareDecimals(caller, global) <= 0 ? caller : global;
}

/**
 * Throws `AMOUNT_OVER_CAP` when `amount` exceeds `cap`. Equal to the cap is
 * allowed. An amount that is not a decimal is left to the tool's own validation,
 * which rejects it anyway.
 */
export function assertWithinAmountCap(amount: string, cap: string | null): void {
  if (cap === null || !AMOUNT_PATTERN.test(amount)) return;
  if (compareDecimals(amount, cap) > 0) {
    throw badInput(`amount ${amount} exceeds the ${cap} cap for this caller`, 'AMOUNT_OVER_CAP');
  }
}

/** The per-key cap the hosted endpoint passes as `authInfo.extra.maxIntentAmount`. */
export function callerAmountCap(extra: { authInfo?: AuthInfo } | undefined): string | null {
  const value = (extra?.authInfo?.extra as { maxIntentAmount?: unknown } | undefined)
    ?.maxIntentAmount;
  return typeof value === 'string' ? value : null;
}
