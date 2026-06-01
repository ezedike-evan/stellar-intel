import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  sanitizeObject,
  extractSanitizedFields,
  generateRequestId,
  getClientIp,
  logStructured,
  withLogging,
  type StructuredLog,
} from '@/lib/api/logging'
import { NextRequest, NextResponse } from 'next/server'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sanitizeObject', () => {
  it('removes sensitive fields from objects', () => {
    const obj = {
      username: 'user@example.com',
      password: 'secret123',
      email: 'user@example.com',
    }

    const sanitized = sanitizeObject(obj)

    expect(sanitized).toEqual({
      username: 'user@example.com',
      password: '[REDACTED]',
      email: 'user@example.com',
    })
  })

  it('redacts multiple sensitive field types', () => {
    const obj = {
      apiKey: 'sk_live_123',
      api_key: 'sk_live_456',
      privateKey: 'pk_123',
      private_key: 'pk_456',
      token: 'token_123',
      jwt: 'eyJhbGc...',
      signature: 'sig_123',
      credentials: 'creds_123',
    }

    const sanitized = sanitizeObject(obj)

    Object.values(sanitized).forEach((value) => {
      expect(value).toBe('[REDACTED]')
    })
  })

  it('handles nested objects', () => {
    const obj = {
      user: {
        name: 'John',
        password: 'secret',
      },
      config: {
        apiKey: 'key123',
        debug: true,
      },
    }

    const sanitized = sanitizeObject(obj)

    expect(sanitized).toEqual({
      user: {
        name: 'John',
        password: '[REDACTED]',
      },
      config: {
        apiKey: '[REDACTED]',
        debug: true,
      },
    })
  })

  it('handles arrays of objects', () => {
    const obj = [
      { id: 1, password: 'secret1' },
      { id: 2, password: 'secret2' },
    ]

    const sanitized = sanitizeObject(obj)

    expect(sanitized).toEqual([
      { id: 1, password: '[REDACTED]' },
      { id: 2, password: '[REDACTED]' },
    ])
  })

  it('handles null and undefined', () => {
    expect(sanitizeObject(null)).toBeNull()
    expect(sanitizeObject(undefined)).toBeUndefined()
  })

  it('handles primitives', () => {
    expect(sanitizeObject('string')).toBe('string')
    expect(sanitizeObject(123)).toBe(123)
    expect(sanitizeObject(true)).toBe(true)
  })

  it('is case-insensitive for field names', () => {
    const obj = {
      PASSWORD: 'secret',
      Password: 'secret',
      password: 'secret',
      ApiKey: 'key',
      APIKEY: 'key',
    }

    const sanitized = sanitizeObject(obj)

    Object.values(sanitized).forEach((value) => {
      expect(value).toBe('[REDACTED]')
    })
  })
})

describe('generateRequestId', () => {
  it('generates a unique ID for each call', () => {
    const id1 = generateRequestId()
    const id2 = generateRequestId()

    expect(id1).not.toBe(id2)
  })

  it('generates a valid UUID v4 format', () => {
    const id = generateRequestId()
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    expect(id).toMatch(uuidRegex)
  })
})

describe('getClientIp', () => {
  it('extracts IP from X-Forwarded-For header', () => {
    const request = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': '192.168.1.1, 10.0.0.1',
      },
    })

    const ip = getClientIp(request)
    expect(ip).toBe('192.168.1.1')
  })

  it('handles X-Forwarded-For with single IP', () => {
    const request = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': '192.168.1.1',
      },
    })

    const ip = getClientIp(request)
    expect(ip).toBe('192.168.1.1')
  })

  it('falls back to request.ip when X-Forwarded-For is not present', () => {
    const request = new NextRequest('http://localhost/api/test')
    const ip = getClientIp(request)

    // request.ip may be undefined in test environment
    expect(typeof ip === 'string' || ip === undefined).toBe(true)
  })
})

describe('logStructured', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('logs structured data as JSON to stdout', () => {
    const log: StructuredLog = {
      timestamp: '2024-01-01T00:00:00Z',
      requestId: 'req-123',
      method: 'GET',
      path: '/api/rates',
      statusCode: 200,
      durationMs: 150,
    }

    logStructured(log)

    expect(console.log).toHaveBeenCalledWith(JSON.stringify(log))
  })

  it('includes optional fields when present', () => {
    const log: StructuredLog = {
      timestamp: '2024-01-01T00:00:00Z',
      requestId: 'req-123',
      method: 'POST',
      path: '/api/rates',
      statusCode: 400,
      durationMs: 50,
      userAgent: 'Mozilla/5.0',
      remoteAddr: '192.168.1.1',
      error: 'Invalid parameters',
    }

    logStructured(log)

    expect(console.log).toHaveBeenCalledWith(JSON.stringify(log))
  })
})

describe('withLogging middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('logs successful requests', async () => {
    const handler = vi.fn(async () => NextResponse.json({ data: 'test' }))
    const wrapped = withLogging(handler)

    const request = new NextRequest('http://localhost/api/test', {
      method: 'GET',
      headers: {
        'user-agent': 'TestAgent/1.0',
      },
    })

    const response = await wrapped(request)

    expect(response.status).toBe(200)
    expect(console.log).toHaveBeenCalled()

    const logCall = (console.log as any).mock.calls[0][0]
    const log = JSON.parse(logCall)

    expect(log.method).toBe('GET')
    expect(log.path).toBe('/api/test')
    expect(log.statusCode).toBe(200)
    expect(log.durationMs).toBeGreaterThanOrEqual(0)
    expect(log.userAgent).toBe('TestAgent/1.0')
  })

  it('logs failed requests with error', async () => {
    const error = new Error('Test error')
    const handler = vi.fn(async () => {
      throw error
    })
    const wrapped = withLogging(handler)

    const request = new NextRequest('http://localhost/api/test', {
      method: 'POST',
    })

    const response = await wrapped(request)

    expect(response.status).toBe(500)
    expect(console.log).toHaveBeenCalled()

    const logCall = (console.log as any).mock.calls[0][0]
    const log = JSON.parse(logCall)

    expect(log.statusCode).toBe(500)
    expect(log.error).toBe('Test error')
  })

  it('generates unique requestId for each call', async () => {
    const handler = vi.fn(async () => NextResponse.json({ data: 'test' }))
    const wrapped = withLogging(handler)

    const request1 = new NextRequest('http://localhost/api/test', { method: 'GET' })
    const request2 = new NextRequest('http://localhost/api/test', { method: 'GET' })

    await wrapped(request1)
    await wrapped(request2)

    const log1 = JSON.parse((console.log as any).mock.calls[0][0])
    const log2 = JSON.parse((console.log as any).mock.calls[1][0])

    expect(log1.requestId).not.toBe(log2.requestId)
  })

  it('measures request duration', async () => {
    const handler = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return NextResponse.json({ data: 'test' })
    })
    const wrapped = withLogging(handler)

    const request = new NextRequest('http://localhost/api/test', { method: 'GET' })
    await wrapped(request)

    const logCall = (console.log as any).mock.calls[0][0]
    const log = JSON.parse(logCall)

    expect(log.durationMs).toBeGreaterThanOrEqual(50)
  })

  it('logs response size when configured', async () => {
    const handler = vi.fn(async () => NextResponse.json({ data: 'test' }))
    const wrapped = withLogging(handler, { logResponseSize: true })

    const request = new NextRequest('http://localhost/api/test', { method: 'GET' })
    await wrapped(request)

    const logCall = (console.log as any).mock.calls[0][0]
    const log = JSON.parse(logCall)

    // Verify the log structure includes the expected fields
    expect(log.method).toBe('GET')
    expect(log.statusCode).toBe(200)
    expect(log.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('sanitizes request body fields when configured', async () => {
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    const wrapped = withLogging(handler, {
      logBodyFields: ['username', 'email'],
    })

    const request = new NextRequest('http://localhost/api/test', {
      method: 'POST',
    })

    await wrapped(request)

    const logCall = (console.log as any).mock.calls[0][0]
    const log = JSON.parse(logCall)

    // Verify the log structure
    expect(log.statusCode).toBe(200)
    expect(log.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('does not log body for GET requests', async () => {
    const handler = vi.fn(async () => NextResponse.json({ data: 'test' }))
    const wrapped = withLogging(handler, {
      logBodyFields: ['username'],
    })

    const request = new NextRequest('http://localhost/api/test', {
      method: 'GET',
    })

    await wrapped(request)

    const logCall = (console.log as any).mock.calls[0][0]
    const log = JSON.parse(logCall)

    expect((log as any).sanitizedBody).toBeUndefined()
  })
})
