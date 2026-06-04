import pino from 'pino'
import { AsyncLocalStorage } from 'async_hooks'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

type LoggerContext = { correlationId: string }

const asyncLocalStorage = new AsyncLocalStorage<LoggerContext>()

const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: null,
  timestamp: pino.stdTimeFunctions.isoTime,
})

function randomCorrelationId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function getCorrelationId(): string | undefined {
  return asyncLocalStorage.getStore()?.correlationId
}

export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return asyncLocalStorage.run({ correlationId }, fn)
}

export function getLogger(moduleName: string) {
  const store = asyncLocalStorage.getStore()
  return baseLogger.child({
    module: moduleName,
    ...(store?.correlationId ? { correlationId: store.correlationId } : {}),
  })
}

export function getCorrelationIdFromRequest(request: NextRequest): string {
  const provided = request.headers.get('x-correlation-id')?.trim()
  return provided && provided.length > 0 ? provided : randomCorrelationId()
}

export async function withRequestLogger(
  request: NextRequest,
  moduleName: string,
  fn: (logger: pino.Logger) => Promise<NextResponse>
): Promise<NextResponse> {
  const correlationId = getCorrelationIdFromRequest(request)
  return runWithCorrelationId(correlationId, async () => {
    const logger = getLogger(moduleName)
    logger.info({ event: 'request.start', method: request.method, url: request.url })
    try {
      const response = await fn(logger)
      response.headers.set('x-correlation-id', correlationId)
      logger.info({ event: 'request.end', status: response.status })
      return response
    } catch (err) {
      logger.error({
        event: 'request.error',
        error: err instanceof Error ? err.message : 'Unknown error',
      })
      const response = NextResponse.json(
        { code: 'INTERNAL_ERROR', message: 'Internal server error' },
        { status: 500 }
      )
      response.headers.set('x-correlation-id', correlationId)
      return response
    }
  })
}

export async function withLoggerContext(
  moduleName: string,
  fn: (logger: pino.Logger) => Promise<NextResponse>
): Promise<NextResponse> {
  const correlationId = randomCorrelationId()
  return runWithCorrelationId(correlationId, async () => {
    const logger = getLogger(moduleName)
    logger.info({ event: 'request.start' })
    try {
      const response = await fn(logger)
      response.headers.set('x-correlation-id', correlationId)
      logger.info({ event: 'request.end', status: response.status })
      return response
    } catch (err) {
      logger.error({
        event: 'request.error',
        error: err instanceof Error ? err.message : 'Unknown error',
      })
      const response = NextResponse.json(
        { code: 'INTERNAL_ERROR', message: 'Internal server error' },
        { status: 500 }
      )
      response.headers.set('x-correlation-id', correlationId)
      return response
    }
  })
}
