import { NextResponse } from 'next/server'
import { fetchAllAnchorFees, computeRateComparison } from '../../../lib/stellar/sep24'
import { FeeBudgetExceededError, filterAnchorRatesByFeeBudget } from '../../../lib/router/solve'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const corridor = url.searchParams.get('corridor')
  const amount = url.searchParams.get('amount')

  if (!corridor || !amount) {
    return NextResponse.json(
      { code: 'INVALID_REQUEST', message: 'Missing required query parameters: corridor, amount' },
      { status: 400 }
    )
  }

  try {
    const results = await fetchAllAnchorFees(amount, corridor)
    const comparison = computeRateComparison(results, corridor)

    if (comparison.rates.length === 0) {
      return NextResponse.json({ rates: comparison, fetchedAt: new Date().toISOString() })
    }

    const filteredRates = filterAnchorRatesByFeeBudget(comparison.rates, amount)
    if (filteredRates.length === 0) {
      throw new FeeBudgetExceededError(Number(amount), undefined)
    }

    const bestRateId = filteredRates.reduce((a, b) => ((b.totalReceived ?? 0) > (a.totalReceived ?? 0) ? b : a)).anchorId

    return NextResponse.json({
      rates: { ...comparison, rates: filteredRates, bestRateId },
      fetchedAt: new Date().toISOString(),
    })
  } catch (error) {
    if (error instanceof FeeBudgetExceededError) {
      return NextResponse.json(
        { code: 'FeeBudgetExceeded', message: error.message },
        { status: 422 }
      )
    }

    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
