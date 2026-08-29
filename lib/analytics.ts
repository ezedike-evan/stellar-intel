/**
 * Privacy-respecting analytics helpers for the off-ramp funnel.
 * Compatible with the Plausible provider integration (#D060 / #746).
 *
 * PII field names are duplicated from `lib/reputation/redact.ts` rather than
 * imported, so this module stays safe to load from client components (redact
 * pulls in Node `crypto`).
 */

declare global {
  interface Window {
    plausible?: (
      eventName: string,
      options?: { props: Record<string, string | number | boolean> }
    ) => void;
  }
}

/** Mirrors `PII_FIELDS` in lib/reputation/redact.ts — keep in sync. */
const ANALYTICS_PII_FIELDS = [
  'recipientAccount',
  'recipientName',
  'recipientEmail',
  'recipientPhone',
  'bankAccount',
  'account',
  'email',
  'phone',
  'name',
  'address',
] as const;

/** Funnel event names for the off-ramp conversion path (#D061 / #747). */
export const FUNNEL_EVENTS = {
  rateTableViewed: 'rate_table_viewed',
  corridorSelected: 'corridor_selected',
  executeDrawerOpened: 'execute_drawer_opened',
  executionConfirmed: 'execution_confirmed',
  executionCompleted: 'execution_completed',
  executionFailed: 'execution_failed',
} as const;

export type FunnelEventName = (typeof FUNNEL_EVENTS)[keyof typeof FUNNEL_EVENTS];

export type FunnelEventProps = {
  corridor?: string;
  anchor?: string;
  /** Coarse amount bucket — never the raw amount. */
  amount_bucket?: string;
  /** Optional failure class for execution_failed (no free-text PII). */
  error_class?: string;
};

/**
 * Maps a raw USDC amount to a coarse bucket so analytics never sees exact
 * financial figures. Buckets are inclusive on the lower bound.
 */
export function amountBucket(amount: string | number | null | undefined): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n) || n < 0) return 'unknown';
  if (n < 10) return '0-10';
  if (n < 50) return '10-50';
  if (n < 100) return '50-100';
  if (n < 500) return '100-500';
  if (n < 1000) return '500-1000';
  return '1000+';
}

/**
 * Scans and redacts PII from event properties before sending to analytics.
 * Ensures no wallet addresses or PII reach the analytics provider.
 */
export function redactProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const safeProps: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties)) {
    if ((ANALYTICS_PII_FIELDS as readonly string[]).includes(key)) {
      safeProps[key] = '[REDACTED]';
      continue;
    }

    if (typeof value === 'string') {
      if (/^G[A-Z0-9]{55}$/.test(value)) {
        safeProps[key] = '[REDACTED_WALLET]';
        continue;
      }
      if (value.includes('@') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        safeProps[key] = '[REDACTED_EMAIL]';
        continue;
      }
    }

    safeProps[key] = value;
  }

  return safeProps;
}

/**
 * Send an event to the analytics provider, ensuring PII is redacted.
 * No-ops when `window.plausible` is unavailable (local / tests without the script).
 */
export function trackAnalyticsEvent(eventName: string, properties?: Record<string, unknown>): void {
  const safeProperties = properties ? redactProperties(properties) : undefined;

  if (typeof window === 'undefined' || !window.plausible) return;

  const props = safeProperties
    ? (Object.fromEntries(
        Object.entries(safeProperties).filter(
          ([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
        )
      ) as Record<string, string | number | boolean>)
    : undefined;

  window.plausible(eventName, props && Object.keys(props).length > 0 ? { props } : undefined);
}

/** Track a typed off-ramp funnel event with corridor/anchor/amount_bucket props. */
export function trackFunnelEvent(eventName: FunnelEventName, props: FunnelEventProps = {}): void {
  const payload: Record<string, unknown> = {};
  if (props.corridor) payload.corridor = props.corridor;
  if (props.anchor) payload.anchor = props.anchor;
  if (props.amount_bucket) payload.amount_bucket = props.amount_bucket;
  if (props.error_class) payload.error_class = props.error_class;
  trackAnalyticsEvent(eventName, payload);
}
