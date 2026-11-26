import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/api/response';
import { isAdminRequest, throttleFailedAdminAuth } from '@/lib/auth/admin';
import { resolveCaller } from '@/lib/auth/caller';
import { hasScope } from '@/lib/auth/api-keys';
import { getAuditStore } from '@/lib/audit/store';
import { recordAuditEvent } from '@/lib/audit/record';
import { toNdjson, toCsv } from '@/lib/audit/export';
import type { ApiError } from '@/types';

export const runtime = 'nodejs';

const CALLER_ID_PATTERN = /^(anonymous|key:[0-9a-f]{16})$/;
const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_ROWS = 50_000;

export async function GET(request: NextRequest): Promise<Response> {
  const limited = await enforceRateLimit(request, {
    bucket: 'api.admin.audit-export',
    maxRequests: 10,
  });
  if (limited) return limited;

  let authorized = false;
  let callerId = 'anonymous';
  let callerKind: 'anonymous' | 'key' | 'token' = 'key';

  if (isAdminRequest(request)) {
    authorized = true;
    callerId = 'admin';
    callerKind = 'key';
  } else {
    const resolution = await resolveCaller(request.headers);
    if (resolution.ok && hasScope(resolution.caller.scopes, 'admin')) {
      authorized = true;
      callerId = resolution.caller.id;
      callerKind = resolution.caller.kind;
    }
  }

  if (!authorized) {
    const throttled = await throttleFailedAdminAuth(request);
    if (throttled) return throttled;
    return NextResponse.json<ApiError>(
      { code: 'FORBIDDEN', message: 'Admin key required' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const fromRaw = searchParams.get('from');
  const toRaw = searchParams.get('to');
  const formatRaw = searchParams.get('format') ?? 'ndjson';
  const filterCallerId = searchParams.get('callerId');

  if (!fromRaw || !toRaw) {
    return NextResponse.json<ApiError>(
      { code: 'VALIDATION_ERROR', message: 'Both "from" and "to" query parameters are required' },
      { status: 400 }
    );
  }

  const fromTime = Date.parse(fromRaw);
  const toTime = Date.parse(toRaw);

  if (isNaN(fromTime) || isNaN(toTime)) {
    return NextResponse.json<ApiError>(
      { code: 'VALIDATION_ERROR', message: '"from" and "to" must be valid ISO date strings' },
      { status: 400 }
    );
  }

  if (fromTime >= toTime) {
    return NextResponse.json<ApiError>(
      { code: 'VALIDATION_ERROR', message: '"from" must be strictly earlier than "to"' },
      { status: 400 }
    );
  }

  if (toTime - fromTime > MAX_RANGE_MS) {
    return NextResponse.json<ApiError>(
      { code: 'VALIDATION_ERROR', message: 'Date range cannot exceed 31 days' },
      { status: 400 }
    );
  }

  if (formatRaw !== 'ndjson' && formatRaw !== 'csv') {
    return NextResponse.json<ApiError>(
      { code: 'VALIDATION_ERROR', message: 'Format must be "ndjson" or "csv"' },
      { status: 400 }
    );
  }

  if (filterCallerId !== null && !CALLER_ID_PATTERN.test(filterCallerId)) {
    return NextResponse.json<ApiError>(
      { code: 'VALIDATION_ERROR', message: 'Invalid callerId filter format' },
      { status: 400 }
    );
  }

  const store = getAuditStore();
  const rawEvents = await store.listRange({
    from: fromRaw,
    to: toRaw,
    limit: MAX_ROWS + 1,
    ...(filterCallerId !== null ? { callerId: filterCallerId } : {}),
  });

  const isTruncated = rawEvents.length > MAX_ROWS;
  const events = isTruncated ? rawEvents.slice(0, MAX_ROWS) : rawEvents;

  const fromDateStr = new Date(fromTime).toISOString().slice(0, 10);
  const toDateStr = new Date(toTime).toISOString().slice(0, 10);
  const filename = `audit-${fromDateStr}-${toDateStr}.${formatRaw}`;

  const body = formatRaw === 'csv' ? toCsv(events) : toNdjson(events);
  const contentType =
    formatRaw === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8';

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Content-Disposition', `attachment; filename="${filename}"`);
  headers.set('Cache-Control', 'no-store');
  if (isTruncated) {
    headers.set('X-Audit-Truncated', 'true');
  }

  recordAuditEvent({
    surface: 'rest',
    action: 'admin.audit.export',
    callerId,
    callerKind,
    scope: 'admin',
    intentHash: null,
    outcome: 'ok',
    status: 200,
    requestId: request.headers.get('x-request-id') ?? null,
  });

  return new Response(body, {
    status: 200,
    headers,
  });
}
