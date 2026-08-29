import { describe, it, expect } from 'vitest';
import { classifyExecuteError, isRetryableExecuteError } from '@/lib/errors/messages';
import { NetworkMismatchError } from '@/lib/stellar/sep10';
import {
  AnchorError,
  ErrorCode,
  NetworkError,
  TimeoutError,
  UserRejectedError,
} from '@/lib/stellar/errors';

describe('classifyExecuteError', () => {
  it('passes through NetworkMismatchError verbatim', () => {
    const err = new NetworkMismatchError('Mainnet', 'Testnet');
    expect(classifyExecuteError(err)).toBe(err.message);
  });

  it('maps a Horizon underfunded result_codes error to a balance message', () => {
    const err = new Error('Transaction failed: tx_failed: [] | op_underfunded: []');
    expect(classifyExecuteError(err)).toBe(
      'Horizon rejected the transaction — check your USDC balance.'
    );
  });

  it('maps a missing-trustline error to a trustline message', () => {
    const err = new Error('Transaction failed: tx_failed: [] | op_no_trust: []');
    expect(classifyExecuteError(err)).toBe(
      'Your wallet does not have a trustline for this asset yet.'
    );
  });

  it('maps an expired-challenge error to a refresh-and-retry message', () => {
    const err = new Error('SEP-10 challenge expired');
    expect(classifyExecuteError(err)).toBe('Anchor challenge expired — refresh and try again.');
  });

  it('falls back to the raw message for unclassified errors', () => {
    const err = new Error('Something entirely unexpected happened');
    expect(classifyExecuteError(err)).toBe('Something entirely unexpected happened');
  });

  it('falls back to "Unknown error" for a non-Error throw', () => {
    expect(classifyExecuteError('a plain string')).toBe('Unknown error');
  });
});

describe('isRetryableExecuteError', () => {
  it('is not retryable for a network mismatch (needs a manual Freighter switch)', () => {
    expect(isRetryableExecuteError(new NetworkMismatchError('Mainnet', 'Testnet'))).toBe(false);
  });

  it('is not retryable for a user rejection', () => {
    expect(isRetryableExecuteError(new UserRejectedError())).toBe(false);
  });

  it('is retryable for a timeout', () => {
    expect(isRetryableExecuteError(new TimeoutError('Request timed out'))).toBe(true);
  });

  it('is retryable for a network error', () => {
    expect(isRetryableExecuteError(new NetworkError('Horizon unreachable'))).toBe(true);
  });

  it('is retryable for a 5xx anchor error', () => {
    expect(
      isRetryableExecuteError(new AnchorError('Anchor 503', ErrorCode.ANCHOR_HTTP_ERROR, 503, null))
    ).toBe(true);
  });

  it('is not retryable for a 4xx anchor error', () => {
    expect(
      isRetryableExecuteError(new AnchorError('Anchor 400', ErrorCode.ANCHOR_HTTP_ERROR, 400, null))
    ).toBe(false);
  });

  it('is not retryable for an insufficient-balance message', () => {
    expect(isRetryableExecuteError(new Error('Transaction failed: op_underfunded'))).toBe(false);
  });

  it('is not retryable for an expired-challenge message', () => {
    expect(isRetryableExecuteError(new Error('SEP-10 challenge expired'))).toBe(false);
  });

  it('defaults to retryable for an unclassified error', () => {
    expect(isRetryableExecuteError(new Error('Something entirely unexpected happened'))).toBe(true);
  });
});
