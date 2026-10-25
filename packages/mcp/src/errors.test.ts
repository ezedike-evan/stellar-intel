import { describe, it, expect } from 'vitest';
import {
  McpToolError,
  badInput,
  anchorUnavailable,
  upstreamTimeout,
  rateLimited,
  fromHttpError,
  fromOfframpError,
  fromOnrampError,
} from './errors.js';
import { OfframpToolError } from '@/lib/mcp/offramp';
import { OnrampToolError } from '@/lib/mcp/onramp';

describe('MCP Error Taxonomy', () => {
  it('asserts BAD_INPUT category', () => {
    const err = badInput('Invalid args', 'INVALID_ARG');
    expect(err).toBeInstanceOf(McpToolError);
    expect(err.category).toBe('BAD_INPUT');
    expect(err.code).toBe('INVALID_ARG');
    expect(err.message).toBe('Invalid args');
  });

  it('asserts ANCHOR_UNAVAILABLE category', () => {
    const err = anchorUnavailable('Anchor down', 'DOWN');
    expect(err.category).toBe('ANCHOR_UNAVAILABLE');
    expect(err.code).toBe('DOWN');
  });

  it('asserts UPSTREAM_TIMEOUT category', () => {
    const err = upstreamTimeout('Network error', 'NET_ERR');
    expect(err.category).toBe('UPSTREAM_TIMEOUT');
    expect(err.code).toBe('NET_ERR');
  });

  it('asserts RATE_LIMITED category', () => {
    const err = rateLimited('Too many requests');
    expect(err.category).toBe('RATE_LIMITED');
    expect(err.code).toBe('RATE_LIMITED'); // defaults to category
  });

  describe('fromHttpError mapper', () => {
    it('maps 400 to BAD_INPUT', () => {
      const err = fromHttpError(400, 'Bad req', 'ctx');
      expect(err.category).toBe('BAD_INPUT');
    });

    it('maps 422 to BAD_INPUT', () => {
      const err = fromHttpError(422, 'Unprocessable', 'ctx');
      expect(err.category).toBe('BAD_INPUT');
    });

    it('maps 404 to ANCHOR_UNAVAILABLE', () => {
      const err = fromHttpError(404, 'Not found', 'ctx');
      expect(err.category).toBe('ANCHOR_UNAVAILABLE');
    });

    it('maps 429 to RATE_LIMITED', () => {
      const err = fromHttpError(429, 'Slow down', 'ctx');
      expect(err.category).toBe('RATE_LIMITED');
    });

    it('maps 500 to UPSTREAM_TIMEOUT', () => {
      const err = fromHttpError(500, 'Server error', 'ctx');
      expect(err.category).toBe('UPSTREAM_TIMEOUT');
    });
  });

  describe('fromOfframpError mapper', () => {
    it('maps NO_ROUTE to BAD_INPUT', () => {
      const err = fromOfframpError(new OfframpToolError('msg', 'NO_ROUTE'));
      expect(err.category).toBe('BAD_INPUT');
    });

    it('maps RATE_UNAVAILABLE to ANCHOR_UNAVAILABLE', () => {
      const err = fromOfframpError(new OfframpToolError('msg', 'RATE_UNAVAILABLE'));
      expect(err.category).toBe('ANCHOR_UNAVAILABLE');
    });

    it('maps TX_BUILD_FAILED to UPSTREAM_TIMEOUT', () => {
      const err = fromOfframpError(new OfframpToolError('msg', 'TX_BUILD_FAILED'));
      expect(err.category).toBe('UPSTREAM_TIMEOUT');
    });

    it('maps SIGNATURE_INVALID to BAD_INPUT', () => {
      const err = fromOfframpError(new OfframpToolError('msg', 'SIGNATURE_INVALID'));
      expect(err.category).toBe('BAD_INPUT');
    });
  });

  describe('fromOnrampError mapper', () => {
    it('maps NO_ROUTE and ACCOUNT_NOT_FOUND to BAD_INPUT', () => {
      expect(fromOnrampError(new OnrampToolError('msg', 'NO_ROUTE')).category).toBe('BAD_INPUT');
      expect(fromOnrampError(new OnrampToolError('msg', 'ACCOUNT_NOT_FOUND')).category).toBe(
        'BAD_INPUT'
      );
    });

    it('maps RATE_UNAVAILABLE to ANCHOR_UNAVAILABLE', () => {
      const err = fromOnrampError(new OnrampToolError('msg', 'RATE_UNAVAILABLE'));
      expect(err.category).toBe('ANCHOR_UNAVAILABLE');
    });

    it('maps TX_BUILD_FAILED to UPSTREAM_TIMEOUT', () => {
      const err = fromOnrampError(new OnrampToolError('msg', 'TX_BUILD_FAILED'));
      expect(err.category).toBe('UPSTREAM_TIMEOUT');
    });

    it('keeps the code and message', () => {
      const err = fromOnrampError(new OnrampToolError('no anchor', 'NO_ROUTE'));
      expect(err.code).toBe('NO_ROUTE');
      expect(err.message).toBe('no anchor');
    });
  });
});
