import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/recurring/authorization-store';
import { computeAuthorizationState } from '@/lib/recurring/due';

export async function GET(req: NextRequest) {
  if (process.env.FLAG_RECURRING_STANDINGS_ENABLED === 'false') {
    return NextResponse.json(
      { error: 'Recurring standing orders are disabled by feature flag' },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const idsParam = url.searchParams.get('ids') || '';
  const senderParam = url.searchParams.get('sender') || '';

  const store = getStore();
  let candidateIds: string[] = [];

  if (idsParam) {
    candidateIds = idsParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[0-9a-f]{64}$/.test(s));
  } else if (senderParam) {
    const list = await store.list({ sender: senderParam });
    candidateIds = list.map((a) => a.termsHash);
  }

  const reminders = [];
  for (const id of candidateIds) {
    const auth = await store.get(id);
    if (auth) {
      reminders.push(computeAuthorizationState(auth));
    }
  }

  return NextResponse.json({ reminders }, { status: 200 });
}
