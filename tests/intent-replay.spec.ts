import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerIntentReplay, clearIntentReplayStore } from '@/lib/intent/replay';

const NOW = Date.parse('2026-05-29T12:00:00.000Z');

const BASE_INPUT = {
  publicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDE',
  nonce: 'nonce-123',
  deadline: '2026-05-29T12:05:00.000Z',
};

beforeEach(() => {
  clearIntentReplayStore();
});

afterEach(() => {
  clearIntentReplayStore();
});

describe('registerIntentReplay', () => {
  it('accepts the first submission of an intent', () => {
    const result = registerIntentReplay(BASE_INPUT, NOW);
    expect(result.ok).toBe(true);
  });

  it('returns 409 for a repeated submission with the same public key and nonce', () => {
    registerIntentReplay(BASE_INPUT, NOW);

    const result = registerIntentReplay(BASE_INPUT, NOW);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe('replay_detected');
      expect(result.message).toMatch(/nonce/i);
    }
  });

  it('returns 410 when the deadline has passed', () => {
    const result = registerIntentReplay(
      { ...BASE_INPUT, deadline: '2026-05-29T11:59:59.000Z' },
      NOW
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(410);
      expect(result.code).toBe('deadline_expired');
      expect(result.message).toMatch(/expired/i);
    }
  });

  it('keeps replay state isolated per public key', () => {
    registerIntentReplay(BASE_INPUT, NOW);

    const result = registerIntentReplay(
      { ...BASE_INPUT, publicKey: 'GBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCD' },
      NOW
    );

    expect(result.ok).toBe(true);
  });
});
