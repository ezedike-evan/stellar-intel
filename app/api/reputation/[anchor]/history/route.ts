import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ANCHORS } from '@/constants'
import type { ApiError } from '@/types'
import type { OutcomeRow } from '@/lib/reputation/aggregate'
import {
  getHistoryBuckets,
  HistoryResponseSchema,
  WINDOW_VALUES,
  type HistoryWindow,
} from '@/lib/reputation/buckets'

// ─── Shared in-memory store (mirrors [anchor]/route.ts outcomeStore) ──────────

const outcomeStore: OutcomeRow[] = []

/** Exposed for testing and seeding only. */
export function _seedOutcomeStore(rows: OutcomeRow[]): void {
  outcomeStore.length = 0
  outcomeStore.push(...rows)
}

// ─── Query schema ─────────────────────────────────────────────────────────────

const QuerySchema = z.object({
  window: z.enum(WINDOW_VALUES).default('30d'),
})

// ─── GET /api/reputation/[anchor]/history ─────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ anchor: string }> | { anchor: string } }
): Promise<NextResponse> {
  const { anchor } = await params

  const knownAnchor = ANCHORS.find((a) => a.id === anchor)
  if (!knownAnchor) {
    return NextResponse.json<ApiError>(
      { code: 'NOT_FOUND', message: `Unknown anchor: ${anchor}` },
      { status: 404 }
    )
  }

  const parsed = QuerySchema.safeParse({
    window: request.nextUrl.searchParams.get('window') ?? undefined,
  })
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return NextResponse.json<ApiError>(
      { code: 'VALIDATION_ERROR', message: first?.message ?? 'Invalid window parameter' },
      { status: 400 }
    )
  }

  const result = getHistoryBuckets(anchor, parsed.data.window as HistoryWindow, outcomeStore)
  return NextResponse.json(HistoryResponseSchema.parse(result))
}
