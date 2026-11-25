import type { Caller } from '@/lib/auth/caller';

export interface GraphQLContext {
  caller: Caller;
  requestId: string;
}
