import { useMemo } from 'react';
import { flags, FlagName } from '@/lib/flags';

export default function useFlag(name: FlagName) {
  // Flags are static for this build; memoize for component use.
  return useMemo(() => flags[name], [name]);
}
