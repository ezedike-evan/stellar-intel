/**
 * @deprecated This module is banned and scheduled for deletion.
 *
 * Estimated rates are synthetic numbers derived from market data; they are NOT
 * quotes from anchor endpoints. Displaying them as real rates misleads users
 * into making financial decisions on fabricated data.
 *
 * Replacement: when all live sources fail, produce an AnchorRate with
 * `source: 'unavailable'` and null numeric fields. The UI renders "—".
 *
 * The ESLint `no-restricted-imports` rule in eslint.config.mjs blocks all new
 * imports of this file. Do not add new callers. Delete this file once all
 * references in the codebase are gone.
 */

/** @deprecated See module-level JSDoc. */
export function getEstimatedRate(
  _corridorId: string,
  _amount: string
): null {
  return null
}
