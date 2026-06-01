import { NextRequest, NextResponse } from 'next/server'

/**
 * Structured log entry for API requests/responses.
 * Designed for log aggregation systems (e.g., CloudWatch, Datadog, ELK).
 */
export interface StructuredLog {
  timestamp: string
  requestId: string
  method: string
  path: string
  statusCode: number
  durationMs: number
  userAgent?: string
  remoteAddr?: string
  error?: string
}

/**
 * Generates a UUID v4 string without external dependencies.
 * Uses crypto.getRandomValues for cryptographic randomness.
 */
function generateUuidV4(): string {
  // Use crypto if available (Node.js and modern browsers)
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16)
    globalThis.crypto.getRandomValues(bytes)

    // Set version to 4 (random)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    // Set variant to RFC 4122
    bytes[8] = (bytes[8] & 0x3f) | 0x80

    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  // Fallback for environments without crypto
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Sensitive field patterns to exclude from logging.
 * These patterns match common sensitive data fields.
 */
const SENSITIVE_PATTERNS = [
  'password',
  'secret',
  'token',
  'jwt',
  'signature',
  'privateKey',
  'private_key',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'credentials',
]

/**
 * Checks if a field name is sensitive and should not be logged.
 */
function isSensitiveField(fieldName: string): boolean {
  const lowerName = fieldName.toLowerCase()
  return SENSITIVE_PATTERNS.some((pattern) => lowerName.includes(pattern.toLowerCase()))
}

/**
 * Sanitizes an object by removing sensitive fields.
 * Returns a new object with sensitive fields removed.
 */
export function sanitizeObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item))
  }

  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveField(key)) {
      sanitized[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value)
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}

/**
 * Extracts sanitized fields from request body for logging.
 * Only logs whitelisted fields to prevent accidental secret leakage.
 */
export async function extractSanitizedFields(
  request: NextRequest,
  whitelist?: string[]
): Promise<Record<string, unknown> | null> {
  try {
    const contentType = request.headers.get('content-type')
    if (!contentType?.includes('application/json')) {
      return null
    }

    const body = await request.json()

    if (!whitelist || whitelist.length === 0) {
      return null
    }

    const sanitized: Record<string, unknown> = {}
    for (const field of whitelist) {
      if (field in body && !isSensitiveField(field)) {
        sanitized[field] = body[field]
      }
    }

    return Object.keys(sanitized).length > 0 ? sanitized : null
  } catch {
    return null
  }
}

/**
 * Logs a structured API request/response entry to stdout.
 * Format is JSON for easy parsing by log aggregation systems.
 */
export function logStructured(log: StructuredLog): void {
  console.log(JSON.stringify(log))
}

/**
 * Generates a unique request ID for correlation across logs.
 * Uses UUID v4 for uniqueness.
 */
export function generateRequestId(): string {
  return generateUuidV4()
}

/**
 * Extracts the client IP address from the request.
 * Checks X-Forwarded-For header first (for proxied requests),
 * then falls back to socket address.
 */
export function getClientIp(request: NextRequest): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }

  return request.ip
}

/**
 * Middleware wrapper for API routes that adds structured logging.
 *
 * Usage:
 * ```ts
 * export const GET = withLogging(async (request) => {
 *   return NextResponse.json({ data: 'value' })
 * })
 * ```
 *
 * @param handler - The API route handler
 * @param options - Configuration options
 * @returns Wrapped handler with logging
 */
export function withLogging(
  handler: (request: NextRequest) => Promise<NextResponse>,
  options?: {
    /** Fields to log from request body (whitelist) */
    logBodyFields?: string[]
    /** Whether to log response body size */
    logResponseSize?: boolean
  }
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const requestId = generateRequestId()
    const startTime = Date.now()
    const method = request.method
    const path = new URL(request.url).pathname
    const userAgent = request.headers.get('user-agent') ?? undefined
    const remoteAddr = getClientIp(request)

    try {
      // Extract sanitized fields if configured
      let sanitizedBody: Record<string, unknown> | null = null
      if (options?.logBodyFields && method !== 'GET' && method !== 'HEAD') {
        sanitizedBody = await extractSanitizedFields(request, options.logBodyFields)
      }

      // Call the handler
      const response = await handler(request)

      // Calculate duration
      const durationMs = Date.now() - startTime

      // Log the request/response
      const log: StructuredLog = {
        timestamp: new Date().toISOString(),
        requestId,
        method,
        path,
        statusCode: response.status,
        durationMs,
        userAgent,
        remoteAddr,
      }

      // Add optional fields
      if (sanitizedBody && Object.keys(sanitizedBody).length > 0) {
        ;(log as any).sanitizedBody = sanitizedBody
      }

      if (options?.logResponseSize) {
        const contentLength = response.headers.get('content-length')
        if (contentLength) {
          ;(log as any).responseSizeBytes = parseInt(contentLength, 10)
        }
      }

      logStructured(log)

      return response
    } catch (error) {
      const durationMs = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      const log: StructuredLog = {
        timestamp: new Date().toISOString(),
        requestId,
        method,
        path,
        statusCode: 500,
        durationMs,
        userAgent,
        remoteAddr,
        error: errorMessage,
      }

      logStructured(log)

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}
