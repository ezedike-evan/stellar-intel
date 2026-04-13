import { NextRequest, NextResponse } from 'next/server'
import { fetchAllAnchorFees, computeRateComparison } from '@/lib/stellar/sep24'
import { isValidCorridorId } from '@/lib/stellar/anchors'
import type { ApiRatesResponse, ApiError } from '@/types'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl

  const corridor = searchParams.get('corridor')
  if (!corridor) {
    return NextResponse.json<ApiError>(
      { code: 'MISSING_CORRIDOR', message: 'Query parameter "corridor" is required' },
      { status: 400 }
    )
  }

  if (!isValidCorridorId(corridor)) {
    return NextResponse.json<ApiError>(
      { code: 'INVALID_CORRIDOR', message: `Unknown corridor: "${corridor}"` },
      { status: 400 }
    )
  }

  const amountParam = searchParams.get('amount') ?? '100'
  const amountNum = Number(amountParam)
  if (!isFinite(amountNum) || amountNum <= 0) {
    return NextResponse.json<ApiError>(
      { code: 'INVALID_AMOUNT', message: 'Query parameter "amount" must be a positive number' },
      { status: 400 }
    )
  }

  const results = await fetchAllAnchorFees(amountParam, corridor)
  const rates = computeRateComparison(results, corridor)

  if (rates.rates.length === 0) {
    return NextResponse.json<ApiError>(
      { code: 'ALL_ANCHORS_FAILED', message: 'All anchor fee requests failed for this corridor' },
      { status: 500 }
    )
  }

  return NextResponse.json<ApiRatesResponse>(
    { rates, fetchedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
