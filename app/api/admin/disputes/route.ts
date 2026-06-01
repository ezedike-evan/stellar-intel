import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/auth/admin';
import type { ApiError } from '@/types';

export type DisputeStatus = 'pending' | 'accepted' | 'rejected';

export interface Dispute {
  id: string;
  submittedBy: string;
  anchorId: string;
  reason: string;
  status: DisputeStatus;
  createdAt: string;
  resolvedAt: string | null;
}

// In-memory store — replace with a database client for production persistence.
const store = new Map<string, Dispute>();

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json<ApiError>(
      { code: 'UNAUTHORIZED', message: 'Admin access required' },
      { status: 401 }
    );
  }

  const disputes = Array.from(store.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return NextResponse.json(disputes);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json<ApiError>(
      { code: 'UNAUTHORIZED', message: 'Admin access required' },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ApiError>(
      { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
      { status: 400 }
    );
  }

  const { id, action } = body as { id?: string; action?: string };

  if (!id || !['accept', 'reject'].includes(action ?? '')) {
    return NextResponse.json<ApiError>(
      { code: 'VALIDATION_ERROR', message: 'id and action (accept|reject) are required' },
      { status: 400 }
    );
  }

  const dispute = store.get(id);
  if (!dispute) {
    return NextResponse.json<ApiError>(
      { code: 'NOT_FOUND', message: 'Dispute not found' },
      { status: 404 }
    );
  }

  dispute.status = action === 'accept' ? 'accepted' : 'rejected';
  dispute.resolvedAt = new Date().toISOString();
  store.set(id, dispute);

  return NextResponse.json(dispute);
}
