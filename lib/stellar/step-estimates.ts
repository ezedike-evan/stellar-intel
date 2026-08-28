import type { ExecuteDrawerStep } from '@/types';

/**
 * Maintainer-set rough duration per ExecuteDrawer step, not derived from live
 * anchor data. Steps without an entry (idle/done/error) show no estimate.
 */
const STEP_TIME_ESTIMATES: Partial<Record<ExecuteDrawerStep, string>> = {
  authenticating: '~5s',
  initiating: '~3s',
  kyc: '~30s',
  form: '~30s',
  building: '~2s',
  signing: '~5s',
};

export function stepTimeEstimate(step: ExecuteDrawerStep): string | null {
  return STEP_TIME_ESTIMATES[step] ?? null;
}
