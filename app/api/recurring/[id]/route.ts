import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/recurring/authorization-store';
import { computeAuthorizationState } from '@/lib/recurring/due';

export async function GET(
  _req: NextRequest,
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
    return NextResponse.json(
      { error: 'Invalid standing authorization id (must be 64-char hex)' },
      { status: 400 }
    );
  }

  const store = getStore();
  const auth = await store.get(id);
  if (!auth) {
    return NextResponse.json({ error: 'Standing authorization not found' }, { status: 404 });
  }

  const reminder = computeAuthorizationState(auth);

  return NextResponse.json({ authorization: auth, reminder }, { status: 200 });
}
