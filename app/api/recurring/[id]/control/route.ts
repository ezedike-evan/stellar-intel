import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/recurring/authorization-store';
import {
  RecurringControlSchema,
  applyControlAction,
  verifyControlSignature,
} from '@/lib/recurring/control';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (process.env.FLAG_RECURRING_STANDINGS_ENABLED === 'false') {
    return NextResponse.json(
      { error: 'Recurring standing orders are disabled by feature flag' },
      { status: 503 }
    );
  }

  const { id } = await params;
  if (!id || !/^[0-9a-f]{64}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid authorization id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parseRes = RecurringControlSchema.safeParse(body);
  if (!parseRes.success) {
    return NextResponse.json(
      { error: 'Invalid control payload', details: parseRes.error.issues },
      { status: 400 }
    );
  }

  const store = getStore();
  const auth = await store.get(id);
  if (!auth) {
    return NextResponse.json({ error: 'Standing authorization not found' }, { status: 404 });
  }

  const validSig = verifyControlSignature(
    auth.terms.sender,
    {
      authorizationId: id,
      action: parseRes.data.action,
      timestamp: parseRes.data.timestamp,
      nonce: parseRes.data.nonce,
    },
    parseRes.data.signature
  );

  if (!validSig) {
    return NextResponse.json({ error: 'Invalid control signature' }, { status: 401 });
  }

  const outcome = applyControlAction(auth, parseRes.data.action);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.message }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const metadata =
    parseRes.data.action === 'pause'
      ? { pausedAt: nowIso }
      : parseRes.data.action === 'cancel'
      ? { cancelledAt: nowIso }
      : undefined;

  const updated = await store.updateStatus(id, outcome.nextStatus, metadata);
  return NextResponse.json({ authorization: updated }, { status: 200 });
}
