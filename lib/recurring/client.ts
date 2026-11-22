import {
  type StandingAuthorizationTerms,
  type SignedStandingAuthorization,
  type StoredStandingAuthorization,
} from '@/types/recurring';

const STORAGE_KEY = 'si_standing_order_ids';

export function loadRecurringIds(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveRecurringId(id: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const current = loadRecurringIds();
    if (!current.includes(id)) {
      current.push(id);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    }
  } catch {
    // no-op
  }
}

export function forgetRecurringId(id: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const current = loadRecurringIds();
    const updated = current.filter((x) => x !== id);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // no-op
  }
}

export function newNonce(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `nonce-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function buildTerms(params: {
  sender: string;
  corridorId: string;
  sourceAsset: string;
  destinationAsset: string;
  amount: string;
  perPeriodCap: string;
  period: 'daily' | 'weekly' | 'monthly';
  startDate?: string;
  stopDate?: string;
  anchorAllowlist: string[];
}): StandingAuthorizationTerms {
  return {
    type: 'recurring-authorization',
    version: 1,
    sender: params.sender,
    corridorId: params.corridorId,
    sourceAsset: params.sourceAsset,
    destinationAsset: params.destinationAsset,
    amount: params.amount,
    perPeriodCap: params.perPeriodCap,
    period: params.period,
    startDate: params.startDate ?? new Date().toISOString(),
    stopDate: params.stopDate,
    anchorAllowlist: params.anchorAllowlist,
    nonce: newNonce(),
  };
}

export async function fetchStandingOrder(
  id: string,
  fetchFn: typeof fetch = fetch
): Promise<StoredStandingAuthorization | null> {
  const res = await fetchFn(`/api/recurring/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch standing order: ${res.statusText}`);
  }
  const data = await res.json();
  return data.authorization ?? null;
}

export async function createStandingOrder(
  signed: SignedStandingAuthorization,
  fetchFn: typeof fetch = fetch
): Promise<StoredStandingAuthorization> {
  const res = await fetchFn('/api/recurring', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signed),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  saveRecurringId(data.authorization.termsHash);
  return data.authorization;
}

export async function sendControl(
  id: string,
  controlPayload: { action: 'pause' | 'resume' | 'cancel'; timestamp: number; nonce: string; signature: string },
  fetchFn: typeof fetch = fetch
): Promise<StoredStandingAuthorization> {
  const res = await fetchFn(`/api/recurring/${id}/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(controlPayload),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  if (controlPayload.action === 'cancel') {
    forgetRecurringId(id);
  }
  return data.authorization;
}
