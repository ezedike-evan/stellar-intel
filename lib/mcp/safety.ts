/**
 * lib/mcp/safety.ts
 *
 * Per-call amount caps for MCP intents (AGS019).
 */

import { AMOUNT_PATTERN } from '@/lib/patterns';
import { compareDecimals } from '@/lib/decimal';
import { badInput } from '@/lib/mcp/errors';
import { getLogger } from '@/lib/logger';

let warnedInvalidCap = false;

/** Test seam to reset the one-time warning flag. */
export function _resetWarnedInvalidCap(): void {
  warnedInvalidCap = false;
}

export function globalAmountCap(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string | null {
  const raw = env.MCP_MAX_INTENT_AMOUNT?.trim();
  if (!raw) return null;

  if (AMOUNT_PATTERN.test(raw) && compareDecimals(raw, '0') > 0) {
    return raw;
  }

  if (!warnedInvalidCap) {
    warnedInvalidCap = true;
    getLogger('mcp.safety').warn(
      { envValue: raw },
      'MCP_MAX_INTENT_AMOUNT is set but invalid; ignoring cap'
    );
  }
  return null;
}

export function effectiveAmountCap(
  callerCap: string | null | undefined,
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
): string | null {
  const global = globalAmountCap(env);
  const trimmed = callerCap?.trim();
  const caller =
    trimmed && AMOUNT_PATTERN.test(trimmed) && compareDecimals(trimmed, '0') > 0 ? trimmed : null;

  if (global !== null && caller !== null) {
    return compareDecimals(caller, global) <= 0 ? caller : global;
  }
  return caller ?? global;
}

export function assertWithinAmountCap(amount: string, cap: string | null): void {
  if (cap !== null && compareDecimals(amount, cap) > 0) {
    throw badInput(`amount ${amount} exceeds the ${cap} cap for this caller`, 'AMOUNT_OVER_CAP');
  }
}
