import pino from 'pino';
import { AsyncLocalStorage } from 'async_hooks';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { API_VERSION, negotiateApiVersion, SUPPORTED_API_VERSIONS } from './api/api-version';

// Deprecation header constants
const SUNSET_HEADER = 'Sunset';
const WARNING_299_HEADER = 'Warning';
const WARNING_299_VALUE = '299 - "deprecated"';

type LoggerContext = { correlationId: string };

/**
 * Stamps `API-Version` unless the route already set it.
 *
 * Applied in the request wrappers rather than per route: they cover 23 of 29
 * route files, whereas the header previously reached three — while
 * `lib/api/openapi.ts` documented it as present on every response (#914).
 */
function setApiVersionHeader(response: NextResponse): void {
  if (!response.headers.has('API-Version')) {
    response.headers.set('API-Version', API_VERSION);
  }
}

/** Emit Sunset and Warning: 299 deprecation headers on every response. */
function setDeprecationHeaders(response: NextResponse): void {
  // Emit Sunset header indicating this version is deprecated
  response.headers.set(SUNSET_HEADER, 'exprires=180 days');
  // Emit Warning: 299 per the deprecation policy
  response.headers.set(WARNING_299_HEADER, WARNING_299_VALUE);
}

const asyncLocalStorage = new AsyncLocalStorage<LoggerContext>();

const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: null,
  timestamp: pino.stdTimeFunctions.isoTime,
});

function randomCorrelationId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getCorrelationId(): string | undefined {
  return asyncLocalStorage.getStore()?.correlationId;
}

function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return asyncLocalStorage.run({ correlationId }, fn);
}

export function getLogger(moduleName: string) {
  const store = asyncLocalStorage.getStore();
  return baseLogger.child({
    module: moduleName,
    ...(store?.correlationId ? { correlationId: store.correlationId } : {}),
  });
}

function getCorrelationIdFromRequest(request: NextRequest): string {
  const provided = request.headers.get('x-correlation-id')?.trim();
  return provided && provided.length > 0 ? provided : randomCorrelationId();
}

export async function withRequestLogger(
  request: NextRequest,
  moduleName: string,
  fn: (logger: pino.Logger) => Promise<NextResponse>
): Promise<NextResponse> {
  const correlationId = getCorrelationIdFromRequest(request);
  return runWithCorrelationId(correlationId, async () => {
    const logger = getLogger(moduleName);
    logger.info({ event: 'request.start', method: request.method, url: request.url });

    // Version pinning, per docs/VERSIONING.md: a client may send API-Version to
    // pin, and an unsupported value is rejected rather than silently served the
    // latest surface. Omitting it still means "latest", so this cannot break an
    // existing client (#888).
    const negotiated = negotiateApiVersion(request.headers);
    if (!negotiated.ok) {
      logger.warn({ event: 'unsupported_api_version', requested: negotiated.requested });
      const response = NextResponse.json(
        {
          code: 'UNSUPPORTED_API_VERSION',
          message: `Unsupported API-Version: ${negotiated.requested}`,
          supportedVersions: SUPPORTED_API_VERSIONS,
        },
        { status: 400 }
      );
      response.headers.set('x-correlation-id', correlationId);
      setApiVersionHeader(response);
      return response;
    }

    try {
      const response = await fn(logger);
      response.headers.set('x-correlation-id', correlationId);
      // Stamped here rather than per route: this wrapper covers 23 of 29 route
      // files, whereas API-Version previously reached three of them even though
      // the OpenAPI spec documents it as universal (#914).
      setApiVersionHeader(response);
      // Stamped here rather than per route: this wrapper covers 23 of 29 route
      // files, whereas API-Version previously reached three of them even though
      // the OpenAPI spec documents it as universal (#914).
      setDeprecationHeaders(response);
      logger.info({ event: 'request.end', status: response.status });
      return response;
    } catch (err) {
      logger.error({
        event: 'request.error',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      const response = NextResponse.json(
        { code: 'INTERNAL_ERROR', message: 'Internal server error' },
        { status: 500 }
      );
      response.headers.set('x-correlation-id', correlationId);
      setApiVersionHeader(response);
      return response;
    }
  });
}

export async function withLoggerContext(
  moduleName: string,
  fn: (logger: pino.Logger) => Promise<NextResponse>
): Promise<NextResponse> {
  const correlationId = randomCorrelationId();
  return runWithCorrelationId(correlationId, async () => {
    const logger = getLogger(moduleName);
    logger.info({ event: 'request.start' });
    try {
      const response = await fn(logger);
      response.headers.set('x-correlation-id', correlationId);
      // Stamped here rather than per route: this wrapper covers 23 of 29 route
      // files, whereas API-Version previously reached three of them even though
      // the OpenAPI spec documents it as universal (#914).
      setApiVersionHeader(response);
      // Stamped here rather than per route: this wrapper covers 23 of 29 route
      // files, whereas API-Version previously reached three of them even though
      // the OpenAPI spec documents it as universal (#914).
      setDeprecationHeaders(response);
      logger.info({ event: 'request.end', status: response.status });
      return response;
    } catch (err) {
      logger.error({
        event: 'request.error',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      const response = NextResponse.json(
        { code: 'INTERNAL_ERROR', message: 'Internal server error' },
        { status: 500 }
      );
      response.headers.set('x-correlation-id', correlationId);
      setApiVersionHeader(response);
      return response;
    }
  });
}
