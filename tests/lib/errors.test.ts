import { describe, it, expect } from 'vitest'
import { SepError, parseSepErrorBody } from '@/lib/stellar/errors'

describe('parseSepErrorBody', () => {
  it('normalizes a JSON API error body { error: string, code: string }', () => {
    const body = { error: 'Invalid asset code', code: 'INVALID_ASSET' }
    const err = parseSepErrorBody(body, 400)

    expect(err).toBeInstanceOf(SepError)
    expect(err.message).toBe('Invalid asset code')
    expect(err.code).toBe('INVALID_ASSET')
    expect(err.httpStatus).toBe(400)
    expect(err.raw).toBe(body)
  })

  it('normalizes a plain string error body', () => {
    const body = 'Unauthorized'
    const err = parseSepErrorBody(body, 401)

    expect(err).toBeInstanceOf(SepError)
    expect(err.message).toBe('Unauthorized')
    expect(err.httpStatus).toBe(401)
    expect(err.raw).toBe(body)
  })

  it('normalizes a nested error body { error: { message, code } }', () => {
    const body = { error: { message: 'Rate limit exceeded', code: 'RATE_LIMIT' } }
    const err = parseSepErrorBody(body, 429)

    expect(err).toBeInstanceOf(SepError)
    expect(err.message).toBe('Rate limit exceeded')
    expect(err.code).toBe('RATE_LIMIT')
    expect(err.httpStatus).toBe(429)
    expect(err.raw).toBe(body)
  })

  it('falls back gracefully when fields are missing (empty object)', () => {
    const body = {}
    const err = parseSepErrorBody(body, 500)

    expect(err).toBeInstanceOf(SepError)
    expect(typeof err.message).toBe('string')
    expect(err.message.length).toBeGreaterThan(0)
    expect(err.httpStatus).toBe(500)
    expect(err.raw).toBe(body)
  })

  it('falls back gracefully for malformed bodies (null, number, undefined)', () => {
    for (const body of [null, 42, undefined]) {
      const err = parseSepErrorBody(body, 503)

      expect(err).toBeInstanceOf(SepError)
      expect(typeof err.message).toBe('string')
      expect(err.message.length).toBeGreaterThan(0)
      expect(err.httpStatus).toBe(503)
      expect(err.raw).toBe(body)
    }
  })
})
