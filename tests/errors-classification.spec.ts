import { describe, it, expect } from 'vitest';
import {
  WalletError,
  UserRejectedError,
  NetworkError,
  ConnectionError,
  UnknownWalletError,
  SepError,
  parseSepErrorBody,
} from '@/lib/stellar/errors';

// ─── WalletError hierarchy ────────────────────────────────────────────────────

const walletCases: Array<{ label: string; error: WalletError; name: string }> = [
  { label: 'UserRejectedError', error: new UserRejectedError(), name: 'UserRejectedError' },
  { label: 'NetworkError', error: new NetworkError('timeout'), name: 'NetworkError' },
  { label: 'ConnectionError', error: new ConnectionError('locked'), name: 'ConnectionError' },
  { label: 'UnknownWalletError', error: new UnknownWalletError('?'), name: 'UnknownWalletError' },
];

describe('WalletError hierarchy', () => {
  for (const { label, error, name } of walletCases) {
    it(`${label} satisfies instanceof chain and .name`, () => {
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(WalletError);
      expect(error.name).toBe(name);
    });
  }
});

// ─── SepError — separate hierarchy ───────────────────────────────────────────

describe('SepError', () => {
  it('satisfies instanceof chain and fields', () => {
    const raw = { error: 'bad' };
    const err = new SepError('bad', 'BAD', 400, raw);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SepError);
    expect(err).not.toBeInstanceOf(WalletError);
    expect(err.name).toBe('SepError');
    expect(err.code).toBe('BAD');
    expect(err.httpStatus).toBe(400);
    expect(err.raw).toBe(raw);
  });
});

// ─── parseSepErrorBody — table-driven failure modes ───────────────────────────

const sepCases: Array<{
  label: string;
  body: unknown;
  httpStatus: number;
  messageContains: string;
  code: string;
}> = [
  {
    label: '{ detail } format',
    body: { detail: 'Asset not supported' },
    httpStatus: 422,
    messageContains: 'Asset not supported',
    code: 'HTTP_422',
  },
  {
    label: '{ message } format',
    body: { message: 'KYC required' },
    httpStatus: 403,
    messageContains: 'KYC required',
    code: 'HTTP_403',
  },
  {
    label: 'JSON API no code field',
    body: { error: 'Bad request' },
    httpStatus: 400,
    messageContains: 'Bad request',
    code: 'HTTP_400',
  },
  {
    label: 'JSON API with a code field',
    body: { error: 'Invalid asset code', code: 'INVALID_ASSET' },
    httpStatus: 400,
    messageContains: 'Invalid asset code',
    code: 'INVALID_ASSET',
  },
  {
    label: 'nested { error: { message, code } }',
    body: { error: { message: 'Rate limit exceeded', code: 'RATE_LIMIT' } },
    httpStatus: 429,
    messageContains: 'Rate limit exceeded',
    code: 'RATE_LIMIT',
  },
  {
    label: 'plain string',
    body: 'Unauthorized',
    httpStatus: 401,
    messageContains: 'Unauthorized',
    code: 'HTTP_401',
  },
  {
    label: 'empty object',
    body: {},
    httpStatus: 500,
    messageContains: 'SEP error: HTTP 500',
    code: 'HTTP_500',
  },
  {
    label: 'number body (malformed)',
    body: 42,
    httpStatus: 503,
    messageContains: 'SEP error: HTTP 503',
    code: 'HTTP_503',
  },
  {
    label: 'whitespace-only string',
    body: '   ',
    httpStatus: 400,
    messageContains: 'SEP error: HTTP 400',
    code: 'HTTP_400',
  },
  {
    label: 'array body (malformed)',
    body: [],
    httpStatus: 500,
    messageContains: 'SEP error: HTTP 500',
    code: 'HTTP_500',
  },
  {
    label: 'HTTP 401 null body',
    body: null,
    httpStatus: 401,
    messageContains: 'SEP error: HTTP 401',
    code: 'HTTP_401',
  },
  {
    label: 'HTTP 404 undefined body',
    body: undefined,
    httpStatus: 404,
    messageContains: 'SEP error: HTTP 404',
    code: 'HTTP_404',
  },
];

describe('parseSepErrorBody — failure mode classification', () => {
  for (const { label, body, httpStatus, messageContains, code } of sepCases) {
    it(label, () => {
      const err = parseSepErrorBody(body, httpStatus);
      expect(err).toBeInstanceOf(SepError);
      expect(err.message).toContain(messageContains);
      expect(err.code).toBe(code);
      expect(err.httpStatus).toBe(httpStatus);
      expect(err.raw).toBe(body);
    });
  }
});
