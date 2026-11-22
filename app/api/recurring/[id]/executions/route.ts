import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/recurring/authorization-store';
import {
  SignedRecurringExecutionSchema,
  verifyRecurringExecution,
} from '@/lib/recurring/execution';
import {
  checkExecutionAgainstAuthorization,
  remainingCapForPeriod,
} from '@/lib/recurring/enforce';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import type { ExecutionRecord } from '@/types/recurring';

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
    return NextResponse.json({ error: 'Invalid standing authorization id' }, { status: 400 });
  }

  const clientIp = getClientIp(req.headers);
  const rl = await checkRateLimit(clientIp, { bucket: 'api.recurring.execute', maxRequests: 20 });
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many execution requests' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parseRes = SignedRecurringExecutionSchema.safeParse(body);
  if (!parseRes.success) {
    return NextResponse.json(
      { error: 'Invalid signed execution schema', details: parseRes.error.issues },
      { status: 400 }
    );
  }

  const signed = parseRes.data;
  if (signed.intent.authorizationId !== id) {
    return NextResponse.json(
      { error: `Path authorizationId ${id} does not match intent ${signed.intent.authorizationId}` },
      { status: 400 }
    );
  }

  const store = getStore();
  const auth = await store.get(id);
  if (!auth) {
    return NextResponse.json({ error: 'Standing authorization not found' }, { status: 404 });
  }

  if (auth.status !== 'active') {
    return NextResponse.json(
      { error: `Cannot execute against standing authorization with status '${auth.status}'` },
      { status: 400 }
    );
  }

  const sigCheck = await verifyRecurringExecution(signed, auth.terms.sender);
  if (!sigCheck.ok) {
    return NextResponse.json({ error: sigCheck.message, code: sigCheck.code }, { status: 401 });
  }

  // Idempotency: if already confirmed for this intentHash, return it
  const existing = auth.executions.find(
    (e) => e.intentHash === signed.intentHash && e.status === 'confirmed'
  );
  if (existing) {
    const { remainingCap } = remainingCapForPeriod(auth.terms, auth.executions);
    return NextResponse.json(
      {
        execution: existing,
        remainingCap,
        idempotent: true,
      },
      { status: 200 }
    );
  }

  // Enforce policies and period limits
  const enforceCheck = checkExecutionAgainstAuthorization({
    terms: auth.terms,
    corridorId: auth.terms.corridorId,
    anchorId: signed.intent.anchorId,
    amount: signed.intent.amount,
    executions: auth.executions,
    timestampMs: signed.intent.timestamp,
  });

  const executionRecordId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (!enforceCheck.ok) {
    const rejectedRecord: ExecutionRecord = {
      id: executionRecordId,
      intentHash: signed.intentHash,
      authorizationId: id,
      sender: auth.terms.sender,
      anchorId: signed.intent.anchorId,
      amount: signed.intent.amount,
      executedAt: new Date(signed.intent.timestamp).toISOString(),
      status: 'rejected',
      rejectionReason: enforceCheck.message,
    };
    await store.recordExecution(id, rejectedRecord);
    return NextResponse.json(
      {
        error: enforceCheck.message,
        code: enforceCheck.code,
        execution: rejectedRecord,
      },
      { status: 400 }
    );
  }

  const confirmedRecord: ExecutionRecord = {
    id: executionRecordId,
    intentHash: signed.intentHash,
    authorizationId: id,
    sender: auth.terms.sender,
    anchorId: signed.intent.anchorId,
    amount: signed.intent.amount,
    executedAt: new Date(signed.intent.timestamp).toISOString(),
    status: 'confirmed',
  };

  await store.recordExecution(id, confirmedRecord);

  return NextResponse.json(
    {
      execution: confirmedRecord,
      remainingCap: enforceCheck.remainingAfter,
      window: enforceCheck.window,
    },
    { status: 201 }
  );
}
