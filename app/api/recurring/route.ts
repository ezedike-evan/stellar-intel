import { NextRequest, NextResponse } from 'next/server';
import { SignedStandingAuthorizationSchema } from '@/types/recurring';
import { verifyStandingAuthorization } from '@/lib/recurring/authorization';
import { getStore } from '@/lib/recurring/authorization-store';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';

export async function POST(req: NextRequest) {
  if (process.env.FLAG_RECURRING_STANDINGS_ENABLED === 'false') {
    return NextResponse.json(
      { error: 'Recurring standing orders are disabled by feature flag' },
      { status: 503 }
    );
  }

  const clientIp = getClientIp(req.headers);
  const rl = await checkRateLimit(clientIp, { bucket: 'api.recurring.create', maxRequests: 30 });
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parseRes = SignedStandingAuthorizationSchema.safeParse(body);
  if (!parseRes.success) {
    return NextResponse.json(
      { error: 'Invalid standing authorization schema', details: parseRes.error.issues },
      { status: 400 }
    );
  }

  const verification = await verifyStandingAuthorization(parseRes.data);
  if (!verification.ok) {
    return NextResponse.json(
      { error: verification.message, code: verification.code },
      { status: 400 }
    );
  }

  const store = getStore();
  const existing = await store.get(parseRes.data.termsHash);
  if (existing) {
    return NextResponse.json({ authorization: existing }, { status: 200 });
  }

  const stored = await store.save(parseRes.data);
  return NextResponse.json({ authorization: stored }, { status: 201 });
}
