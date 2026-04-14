import { NextRequest, NextResponse } from 'next/server'
import { fetchAllAnchorFees, computeRateComparison } from '@/lib/stellar/sep24'
import { fetchEstimatedRates } from '@/lib/stellar/estimatedRates'
import { isValidCorridorId } from '@/lib/stellar/anchors'
import type { AnchorRate, ApiRatesResponse, ApiError } from '@/types'

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

  // Try live anchor fee APIs first
  const results = await fetchAllAnchorFees(amountParam, corridor)
  const rates = computeRateComparison(results, corridor)

  // If all anchor APIs failed, fall back to market-rate estimates
  let liveRates: AnchorRate[] = rates.rates
  if (liveRates.length === 0) {
    try {
      liveRates = await fetchEstimatedRates(corridor, amountParam)
    } catch {
      return NextResponse.json<ApiError>(
        {
          code: 'ALL_ANCHORS_FAILED',
          message: 'Unable to fetch rates. Please try again shortly.',
        },
        { status: 500 }
      )
    }
  }

  const bestRateId = liveRates.reduce((best, r) =>
    r.totalReceived > (liveRates.find((x) => x.anchorId === best)?.totalReceived ?? 0) ? r.anchorId : best,
    liveRates[0].anchorId
  )

  return NextResponse.json<ApiRatesResponse>(
    {
      rates: { corridorId: corridor, rates: liveRates, bestRateId },
      fetchedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
