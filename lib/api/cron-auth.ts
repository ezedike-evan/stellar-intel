import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

// Shared authorization for the scheduled endpoints (publisher/tick,
// reputation/reconcile, reputation/refresh).
//
// Fails CLOSED. The previous inline check compared the Authorization header
// against `Bearer ${process.env.CRON_SECRET}` with a plain `!==`. Two problems:
//
//  1. Fail-open when unset: with CRON_SECRET undefined the expected value was the
//     literal string "Bearer undefined", so anyone sending that exact header
//     authenticated. Now a missing/empty secret rejects every request (500 —
//     misconfiguration, not a client error) rather than granting access.
//  2. Non-constant-time compare leaked the secret through timing. The compare is
//     now `crypto.timingSafeEqual`.

/**
 * Returns a NextResponse to short-circuit with when the request is NOT authorized
 * (500 if the cron secret is unconfigured, 401 if the bearer token is wrong), or
 * null when the request carries the correct secret.
 */
export function checkCronAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Cron authentication is not configured' }, { status: 500 });
  }

  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;

  const provided = Buffer.from(header);
  const wanted = Buffer.from(expected);

  // timingSafeEqual requires equal-length buffers and throws otherwise. The
  // length of the header is not itself secret, so guarding on it first is safe.
  const authorized = provided.length === wanted.length && timingSafeEqual(provided, wanted);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
