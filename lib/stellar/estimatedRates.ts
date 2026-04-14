import { getAnchorsByCorridorId, getCorridorById } from './anchors'
import { computeTotalReceived } from '@/lib/utils'
import type { AnchorRate } from '@/types'

// Typical anchor fees in USDC per corridor (approximate market rates)
const TYPICAL_FEES: Record<string, number> = {
  'usdc-ngn': 2,
  'usdc-kes': 1.5,
  'usdc-ghs': 1.5,
  'usdc-mxn': 2,
  'usdc-brl': 2,
}

// Currency code to ISO 4217 for the exchange rate API
const CORRIDOR_CURRENCY: Record<string, string> = {
  'usdc-ngn': 'NGN',
  'usdc-kes': 'KES',
  'usdc-ghs': 'GHS',
  'usdc-mxn': 'MXN',
  'usdc-brl': 'BRL',
}

/**
 * Fetches live USD→fiat exchange rates from open.er-api.com (no API key required).
 * Returns a map of ISO currency code → rate.
 */
async function fetchUsdRates(): Promise<Record<string, number>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Exchange rate API returned HTTP ${res.status}`)
    const data = (await res.json()) as { result?: string; rates?: Record<string, number> }
    if (data.result !== 'success' || !data.rates) {
      throw new Error('Unexpected response from exchange rate API')
    }
    return data.rates
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Builds estimated AnchorRate entries for all anchors in a corridor using live
 * market exchange rates and typical anchor fee assumptions.
 *
 * Used as a fallback when direct anchor fee API calls all fail.
 */
export async function fetchEstimatedRates(
  corridorId: string,
  amount: string
): Promise<AnchorRate[]> {
  const anchors = getAnchorsByCorridorId(corridorId)
  const corridor = getCorridorById(corridorId)
  const currency = CORRIDOR_CURRENCY[corridorId] ?? corridor.to.toUpperCase()
  const typicalFee = TYPICAL_FEES[corridorId] ?? 2
  const amountNum = Number(amount)

  const usdRates = await fetchUsdRates()
  const baseRate = usdRates[currency]
  if (!baseRate) throw new Error(`No exchange rate found for currency: ${currency}`)

  // Simulate slight rate variation between anchors (±0.5%) so the comparison is meaningful
  const variations = [0, 0.003, -0.005]

  return anchors.map((anchor, i) => {
    const variation = variations[i % variations.length]
    const exchangeRate = parseFloat((baseRate * (1 + variation)).toFixed(4))
    const fee = typicalFee + i * 0.5 // slight fee variation per anchor

    return {
      anchorId: anchor.id,
      anchorName: anchor.name,
      corridorId,
      fee,
      feeType: 'flat' as const,
      exchangeRate,
      totalReceived: computeTotalReceived(amountNum, fee, 0, exchangeRate),
      updatedAt: new Date(),
      source: 'estimated' as const,
    }
  })
}
