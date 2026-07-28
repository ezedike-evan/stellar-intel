import { PII_FIELDS } from './reputation/redact';

declare global {
  interface Window {
    plausible?: (eventName: string, options?: { props: Record<string, unknown> }) => void;
  }
}

/**
 * Scans and redacts PII from event properties before sending to analytics.
 * This ensures no wallet addresses or PII reach the analytics provider.
 */
export function redactProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const safeProps: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties)) {
    // 1. Remove explicit PII keys based on reputation redaction lists
    if ((PII_FIELDS as readonly string[]).includes(key)) {
      safeProps[key] = '[REDACTED]';
      continue;
    }

    // 2. Filter out Stellar wallet addresses (starts with G, 56 chars) from any string value
    if (typeof value === 'string') {
      if (/^G[A-Z0-9]{55}$/.test(value)) {
        safeProps[key] = '[REDACTED_WALLET]';
        continue;
      }
      // Basic email check in values just in case
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
 */
export function trackAnalyticsEvent(eventName: string, properties?: Record<string, unknown>) {
  const safeProperties = properties ? redactProperties(properties) : undefined;

  // Send to privacy-respecting provider (Plausible)
  if (typeof window !== 'undefined' && window.plausible) {
    window.plausible(eventName, safeProperties ? { props: safeProperties } : undefined);
  }
}
