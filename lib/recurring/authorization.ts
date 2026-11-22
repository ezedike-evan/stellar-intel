import { hashIntent, type HashableIntent } from '@/lib/intent/hash';
import type { StandingAuthorizationTerms } from '@/types/recurring';

export const STANDING_AUTHORIZATION_MAX_DAYS = 366;

export async function hashStandingAuthorization(
  terms: StandingAuthorizationTerms
): Promise<string> {
  return hashIntent(terms as unknown as HashableIntent);
}
