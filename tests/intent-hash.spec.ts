import { describe, it, expect } from 'vitest';
import { canonicalJson, hashIntent } from '@/lib/intent/hash';
import type { Intent } from '@/lib/intent/hash';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_INTENT: Intent = {
  type: 'offramp',
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '100',
  sender: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789',
  recipient: 'NGN-BANK-ACCOUNT-123',
};

// Known-good SHA-256 of the canonical JSON for BASE_INTENT (hex).
// canonical: {"amount":"100","destinationAsset":"NGN","recipient":"NGN-BANK-ACCOUNT-123","sender":"GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789","sourceAsset":"USDC","type":"offramp"}
const CANONICAL =
  '{"amount":"100","destinationAsset":"NGN","recipient":"NGN-BANK-ACCOUNT-123","sender":"GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789","sourceAsset":"USDC","type":"offramp"}';

async function computeKnownHash(): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(CANONICAL));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── canonicalJson ────────────────────────────────────────────────────────────

describe('canonicalJson', () => {
  it('produces JSON with keys sorted alphabetically', () => {
    const json = canonicalJson(BASE_INTENT);
    const keys = Object.keys(JSON.parse(json) as Record<string, unknown>);
    expect(keys).toEqual([...keys].sort());
  });

  it('produces identical output regardless of input key order', () => {
    const shuffled: Intent = {
      recipient: BASE_INTENT.recipient,
      type: BASE_INTENT.type,
      sender: BASE_INTENT.sender,
      amount: BASE_INTENT.amount,
      destinationAsset: BASE_INTENT.destinationAsset,
      sourceAsset: BASE_INTENT.sourceAsset,
    };
    expect(canonicalJson(BASE_INTENT)).toBe(canonicalJson(shuffled));
  });

  it('contains no whitespace outside string values', () => {
    const json = canonicalJson(BASE_INTENT);
    // Canonical JSON must not contain spaces, tabs, or newlines between tokens
    expect(json).not.toMatch(/[^"]\s/);
  });

  it('sorts nested object keys recursively', () => {
    const nested: Intent = {
      ...BASE_INTENT,
      meta: { z: 1, a: 2, m: 3 },
    };
    const parsed = JSON.parse(canonicalJson(nested)) as Record<string, unknown>;
    const metaKeys = Object.keys(parsed['meta'] as Record<string, unknown>);
    expect(metaKeys).toEqual([...metaKeys].sort());
  });
});

// ─── hashIntent ───────────────────────────────────────────────────────────────

describe('hashIntent', () => {
  it('returns a 64-character lowercase hex string', async () => {
    const hash = await hashIntent(BASE_INTENT);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches known-good fixture', async () => {
    expect(await hashIntent(BASE_INTENT)).toBe(await computeKnownHash());
  });

  it('is stable across equivalent intents with different key ordering', async () => {
    const reordered: Intent = {
      amount: BASE_INTENT.amount,
      type: BASE_INTENT.type,
      recipient: BASE_INTENT.recipient,
      destinationAsset: BASE_INTENT.destinationAsset,
      sender: BASE_INTENT.sender,
      sourceAsset: BASE_INTENT.sourceAsset,
    };
    expect(await hashIntent(BASE_INTENT)).toBe(await hashIntent(reordered));
  });

  it('produces different hashes for intents that differ by a single field', async () => {
    const modified: Intent = { ...BASE_INTENT, amount: '200' };
    expect(await hashIntent(BASE_INTENT)).not.toBe(await hashIntent(modified));
  });

  it('hash changes when recipient changes', async () => {
    const modified: Intent = { ...BASE_INTENT, recipient: 'DIFFERENT-ACCOUNT' };
    expect(await hashIntent(BASE_INTENT)).not.toBe(await hashIntent(modified));
  });

  it('is idempotent — same input always yields same hash', async () => {
    const h1 = await hashIntent(BASE_INTENT);
    const h2 = await hashIntent(BASE_INTENT);
    const h3 = await hashIntent(BASE_INTENT);
    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
  });

  it('handles intents with numeric and boolean extra fields deterministically', async () => {
    const extended: Intent = {
      ...BASE_INTENT,
      slippage: 0.005,
      urgent: false,
    };
    const h1 = await hashIntent(extended);
    const h2 = await hashIntent({ urgent: false, slippage: 0.005, ...BASE_INTENT });
    expect(h1).toBe(h2);
  });
});
