# API Request/Response Logging

This document describes the structured logging format used for all API routes in Stellar Intel.

## Overview

All API routes are instrumented with structured logging middleware that captures request/response metadata in JSON format. Logs are written to stdout for easy integration with log aggregation systems (CloudWatch, Datadog, ELK, etc.).

## Log Format

Each API request generates a single JSON log entry with the following structure:

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "method": "GET",
  "path": "/api/rates",
  "statusCode": 200,
  "durationMs": 145,
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
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

## Security & Privacy

### Sensitive Data Handling

The logging middleware **never logs**:
- Full request/response bodies
- Passwords, secrets, tokens, or keys
- Private keys or signatures
- Authorization headers
- Cookies or credentials

### Sensitive Field Detection

The following field names are automatically redacted:
- `password`, `secret`, `token`, `jwt`
- `signature`, `privateKey`, `private_key`
- `apiKey`, `api_key`
- `authorization`, `cookie`, `credentials`

Detection is **case-insensitive** and matches partial field names.

### Whitelisting Request Fields

To log specific request fields, use the `logBodyFields` option:

```typescript
export const POST = withLogging(handler, {
  logBodyFields: ['username', 'email', 'corridorId'],
})
```

Only whitelisted fields are logged, and sensitive fields are still redacted even if whitelisted.

Example log with sanitized body:

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "method": "POST",
  "path": "/api/rates",
  "statusCode": 200,
  "durationMs": 145,
  "sanitizedBody": {
    "corridorId": "usdc-ngn",
    "amount": "100"
  }
}
```

## Request Correlation

Use the `requestId` field to correlate logs across multiple systems:

1. **Client-side**: Include `requestId` in error reports or support tickets
2. **Log aggregation**: Query logs by `requestId` to trace full request lifecycle
3. **Distributed tracing**: Pass `requestId` to downstream services via headers

Example query in CloudWatch:

```
fields @timestamp, @message, requestId, statusCode, durationMs
| filter requestId = "550e8400-e29b-41d4-a716-446655440000"
```

## Response Size Logging

To log response body size (without content), enable `logResponseSize`:

```typescript
export const GET = withLogging(handler, {
  logResponseSize: true,
})
```

This adds `responseSizeBytes` to the log entry, useful for:
- Monitoring large payload responses
- Detecting performance regressions
- Capacity planning

## Error Logging

When a request fails (throws an exception), the log includes:

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "method": "GET",
  "path": "/api/rates",
  "statusCode": 500,
  "durationMs": 45,
  "error": "Failed to fetch anchor rates"
}
```

The middleware catches all exceptions and returns a generic 500 response to prevent information leakage.

## Usage Examples

### Basic GET endpoint

```typescript
import { withLogging } from '@/lib/api/logging'
import { NextRequest, NextResponse } from 'next/server'

async function getStatus(request: NextRequest) {
  return NextResponse.json({ status: 'ok' })
}

export const GET = withLogging(getStatus)
```

### POST endpoint with body logging

```typescript
async function createTransaction(request: NextRequest) {
  const body = await request.json()
  // ... process request
  return NextResponse.json({ transactionId: '123' })
}

export const POST = withLogging(createTransaction, {
  logBodyFields: ['corridorId', 'amount'],
  logResponseSize: true,
})
```

### Full example with error handling

```typescript
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

## Log Aggregation Integration

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

## Performance Considerations

- Logging adds minimal overhead (~1-5ms per request)
- JSON serialization is fast for typical log sizes
- No blocking I/O; logs are written asynchronously to stdout
- Request body parsing only occurs if `logBodyFields` is configured

## Testing

The logging middleware includes comprehensive test coverage:

```bash
npm test -- tests/api/logging.spec.ts
```

Tests verify:
- Sensitive field redaction
- Request correlation via requestId
- Duration measurement accuracy
- Error handling and recovery
- Response size logging
- Body field whitelisting
