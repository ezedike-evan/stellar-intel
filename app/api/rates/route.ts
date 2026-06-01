import { NextRequest, NextResponse } from 'next/server'
import { withLogging } from '@/lib/api/logging'
import { getAnchorsByCorridorId } from '@/lib/stellar/anchors'
import { getSep24Fee } from '@/lib/stellar/sep24'
import { getResolvedAnchorById } from '@/lib/stellar/anchors'
import type { ApiRatesResponse, AnchorRate } from '@/types'

/**
 * GET /api/rates
 *
 * Fetches and compares rates from all anchors for a given corridor and amount.
 *
 * Query Parameters:
 * - corridor: string (required) - The corridor ID (e.g., 'usdc-ngn')
 * - amount: string (required) - The amount to withdraw
 *
 * Response:
 * - 200: { rates: RateComparison, fetchedAt: string }
 * - 400: { error: string } - Missing or invalid parameters
 * - 500: { error: string } - Server error
 */
async function getRates(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const corridorId = searchParams.get('corridor')
  const amount = searchParams.get('amount')

  // Validate parameters
  if (!corridorId || !amount) {
    return NextResponse.json(
      { error: 'Missing required parameters: corridor, amount' },
      { status: 400 }
    )
  }

  // Validate amount is a valid number
  if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return NextResponse.json({ error: 'Invalid amount: must be a positive number' }, { status: 400 })
  }

  try {
    // Get all anchors for this corridor
    const anchors = getAnchorsByCorridorId(corridorId)

    if (anchors.length === 0) {
      return NextResponse.json(
        {
          rates: { corridorId, rates: [], bestRateId: '' },
          fetchedAt: new Date().toISOString(),
        } as ApiRatesResponse,
        { status: 200 }
      )
    }

    // Fetch rates from all anchors in parallel
    const ratePromises = anchors.map(async (anchor) => {
      try {
        const resolved = await getResolvedAnchorById(anchor.id)
        const transferServer = resolved.TRANSFER_SERVER_SEP0024

        if (!transferServer) {
          return {
            anchorId: anchor.id,
            anchorName: anchor.name,
            rate: null,
            error: 'No transfer server available',
          }
        }

        const feeResult = await getSep24Fee({
          transferServer,
          assetCode: anchor.assetCode,
          assetIssuer: anchor.assetIssuer,
          amount,
          type: 'external',
        })

        if (!feeResult.ok) {
          return {
            anchorId: anchor.id,
            anchorName: anchor.name,
            rate: null,
            error: `Fee fetch failed: ${feeResult.reason}`,
          }
        }

        const fee = typeof feeResult.fee === 'string' ? parseFloat(feeResult.fee) : feeResult.fee
        const exchangeRate = 1 // Placeholder; in production, fetch from market data
        const totalReceived = (parseFloat(amount) - fee) * exchangeRate

        const rate: AnchorRate = {
          anchorId: anchor.id,
          anchorName: anchor.name,
          corridorId,
          fee: fee.toString(),
          exchangeRate,
          totalReceived,
          source: 'sep24-fee',
          updatedAt: new Date(),
        }

        return {
          anchorId: anchor.id,
          anchorName: anchor.name,
          rate,
          error: null,
        }
      } catch (err) {
        return {
          anchorId: anchor.id,
          anchorName: anchor.name,
          rate: null,
          error: err instanceof Error ? err.message : 'Unknown error',
        }
      }
    })

    const results = await Promise.all(ratePromises)

    // Filter successful rates
    const validRates = results
      .filter((r) => r.rate !== null)
      .map((r) => r.rate as AnchorRate)

    // Find best rate
    let bestRateId = ''
    if (validRates.length > 0) {
      const best = validRates.reduce((a, b) =>
        (b.totalReceived ?? 0) > (a.totalReceived ?? 0) ? b : a
      )
      bestRateId = best.anchorId
    }

    const response: ApiRatesResponse = {
      rates: {
        corridorId,
        rates: validRates,
        bestRateId,
      },
      fetchedAt: new Date().toISOString(),
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Apply logging middleware
export const GET = withLogging(getRates, {
  logResponseSize: true,
})
