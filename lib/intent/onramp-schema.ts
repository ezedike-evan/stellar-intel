/**
 * lib/intent/onramp-schema.ts
 *
 * The on-ramp (deposit) intent schema, re-exported from `@/types/intent` so the
 * router, API, and SDK import it the same way they import the off-ramp intent
 * via `lib/intent/schema.ts`. No endpoint consumes it yet — this lands the
 * shape first so the deposit flow has something to validate against.
 */
export {
  OnrampIntentSchema,
  OnrampDepositMethodSchema,
  OnrampMemoTypeSchema,
  ONRAMP_DEPOSIT_METHODS,
  ONRAMP_MEMO_TYPES,
} from '@/types/intent';
export type { OnrampIntent, OnrampDepositMethod, OnrampMemoType } from '@/types/intent';
