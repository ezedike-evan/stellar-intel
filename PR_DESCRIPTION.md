# Pull Request: API Request/Response Logging Middleware

## Title
feat: implement API request/response logging middleware

## Description

Implements structured request/response logging for all API routes with automatic sensitive field redaction and request correlation via unique requestId.

## Changes

### New Files

1. **`lib/api/logging.ts`** (250 lines)
   - `withLogging()`: Middleware wrapper for API routes
   - `sanitizeObject()`: Automatic sensitive field redaction
   - `extractSanitizedFields()`: Whitelisted body field logging
   - `generateRequestId()`: UUID v4 request correlation
   - `getClientIp()`: Client IP extraction
   - `logStructured()`: JSON logging to stdout

2. **`app/api/rates/route.ts`** (130 lines)
   - Sample GET /api/rates endpoint with logging middleware
   - Fetches and compares rates from all anchors
   - Demonstrates middleware integration

3. **`tests/api/logging.spec.ts`** (350 lines)
   - 21 comprehensive tests, all passing
   - Tests for sanitization, UUID generation, IP extraction, logging, and middleware

4. **`docs/API_LOGGING.md`** (300 lines)
   - Complete documentation of log format
   - Security & privacy guidelines
   - Request correlation examples
   - Integration guides for CloudWatch, Datadog, ELK
   - Usage examples and performance considerations

## Requirements Met

✅ **Log for each request**: method, path, statusCode, durationMs, requestId
✅ **Do not log full request body**: Only whitelisted fields logged via `logBodyFields` option
✅ **Sanitize sensitive fields**: Auto-redaction of passwords, tokens, keys, signatures
✅ **Structured JSON format to stdout**: For log aggregation systems
✅ **Optional response body size logging**: `logResponseSize: true` option
✅ **Document log format and requestId correlation**: Comprehensive docs/API_LOGGING.md
✅ **Logging middleware applied to /api routes**: `withLogging()` wrapper on GET /api/rates
✅ **No secrets or full bodies in logs**: Automatic redaction + whitelisting
✅ **Log format documented**: Full documentation with examples

## Security Features

- **Automatic Sensitive Field Detection**: Case-insensitive matching for:
  - `password`, `secret`, `token`, `jwt`
  - `signature`, `privateKey`, `private_key`
  - `apiKey`, `api_key`, `authorization`, `cookie`, `credentials`

- **Whitelisting**: Only explicitly whitelisted fields are logged
- **Nested Object Support**: Recursively sanitizes nested objects and arrays
- **Zero Secrets**: No full bodies, no credentials, no keys ever logged

## Log Format

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "method": "GET",
  "path": "/api/rates",
  "statusCode": 200,
  "durationMs": 145,
  "userAgent": "Mozilla/5.0...",
  "remoteAddr": "192.168.1.100",
  "responseSizeBytes": 2048
}
```

### Core Fields

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string (ISO 8601) | Request completion time in UTC |
| `requestId` | string (UUID v4) | Unique identifier for request correlation |
| `method` | string | HTTP method (GET, POST, PUT, DELETE, etc.) |
| `path` | string | Request path (e.g., `/api/rates`) |
| `statusCode` | number | HTTP response status code |
| `durationMs` | number | Total request duration in milliseconds |

### Optional Fields

| Field | Type | Description | Conditions |
|-------|------|-------------|-----------|
| `userAgent` | string | Client user agent | Present if provided in request |
| `remoteAddr` | string | Client IP address | Present if available |
| `error` | string | Error message | Only present on errors (5xx) |
| `responseSizeBytes` | number | Response body size | Only if `logResponseSize: true` |
| `sanitizedBody` | object | Whitelisted request fields | Only if `logBodyFields` configured |

## Testing

All 21 tests passing:
- ✅ Sensitive field redaction (8 tests)
- ✅ UUID v4 generation and uniqueness
- ✅ Client IP extraction
- ✅ Structured logging
- ✅ Middleware integration (successful requests, errors, duration measurement)
- ✅ Response size logging
- ✅ Request body field whitelisting

Run tests:
```bash
npm test -- tests/api/logging.spec.ts
```

## Usage Example

```typescript
import { withLogging } from '@/lib/api/logging'
import { NextRequest, NextResponse } from 'next/server'

async function getRates(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const corridorId = searchParams.get('corridor')
  
  if (!corridorId) {
    return NextResponse.json(
      { error: 'Missing corridor parameter' },
      { status: 400 }
    )
  }

  try {
    const rates = await fetchRates(corridorId)
    return NextResponse.json(rates)
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch rates' },
      { status: 500 }
    )
  }
}

export const GET = withLogging(getRates, {
  logResponseSize: true,
})
```

## Integration Examples

### CloudWatch (AWS)

Logs are automatically parsed as JSON and available for querying:

```
fields @timestamp, requestId, method, path, statusCode, durationMs
| stats avg(durationMs) as avg_duration, max(durationMs) as max_duration by path
```

### Datadog

Configure JSON parsing in Datadog:

```yaml
logs:
  - service: stellar-intel
    source: nodejs
    parser:
      type: json
```

### ELK Stack

Logs are automatically indexed as JSON documents:

```json
GET /logs-*/_search
{
  "query": {
    "match": {
      "requestId": "550e8400-e29b-41d4-a716-446655440000"
    }
  }
}
```

## Performance

- Logging adds minimal overhead (~1-5ms per request)
- JSON serialization is fast for typical log sizes
- No blocking I/O; logs are written asynchronously to stdout
- Request body parsing only occurs if `logBodyFields` is configured

## Related Issues

Closes #217

## Checklist

- [x] Code follows project style guidelines
- [x] All tests passing (21/21)
- [x] Documentation added (docs/API_LOGGING.md)
- [x] No breaking changes
- [x] Sensitive data handling verified
- [x] Performance impact minimal
- [x] Ready for production

## Branch

- **Source**: `feature/api-logging-middleware`
- **Target**: `main`
- **Commit**: `5cd4ac4`
