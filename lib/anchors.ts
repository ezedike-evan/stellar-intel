import type { AnchorRate } from '@/types'
import { computeTotalReceived } from './stellar'
import { KNOWN_ANCHORS } from '@/constants'

// MOCK — Replace with real SEP-24 endpoint calls when available
const MOCK_RATES: Record<string, Record<string, Omit<AnchorRate, 'anchorId' | 'anchorName' | 'lastUpdated' | 'isMock' | 'totalReceived'>>> = {
  NG: {
    bitso: { exchangeRate: 0, fee: 0, feePercent: 0, minAmount: 0, maxAmount: 0, estimatedTime: '', depositMethods: [], country: 'NG', currency: 'NGN' },
    cowrie: { exchangeRate: 1545.50, fee: 2.00, feePercent: 0.005, minAmount: 10, maxAmount: 10000, estimatedTime: '1–3 hours', depositMethods: ['bank_transfer'], country: 'NG', currency: 'NGN' },
    flutterwave: { exchangeRate: 1538.00, fee: 3.50, feePercent: 0.008, minAmount: 20, maxAmount: 5000, estimatedTime: '2–4 hours', depositMethods: ['bank_transfer', 'mobile_money'], country: 'NG', currency: 'NGN' },
  },
  KE: {
    flutterwave: { exchangeRate: 128.40, fee: 1.50, feePercent: 0.006, minAmount: 10, maxAmount: 5000, estimatedTime: '1–2 hours', depositMethods: ['bank_transfer', 'mobile_money'], country: 'KE', currency: 'KES' },
  },
  GH: {
    flutterwave: { exchangeRate: 14.20, fee: 1.00, feePercent: 0.007, minAmount: 10, maxAmount: 3000, estimatedTime: '2–6 hours', depositMethods: ['bank_transfer', 'mobile_money'], country: 'GH', currency: 'GHS' },
  },
  PH: {
    mychoice: { exchangeRate: 57.80, fee: 2.00, feePercent: 0.005, minAmount: 10, maxAmount: 5000, estimatedTime: '1–2 hours', depositMethods: ['bank_transfer', 'mobile_money', 'cash'], country: 'PH', currency: 'PHP' },
  },
  MX: {
    bitso: { exchangeRate: 17.25, fee: 0.50, feePercent: 0.003, minAmount: 5, maxAmount: 50000, estimatedTime: '< 30 minutes', depositMethods: ['bank_transfer'], country: 'MX', currency: 'MXN' },
  },
  BR: {
    bitso: { exchangeRate: 5.12, fee: 1.00, feePercent: 0.004, minAmount: 10, maxAmount: 20000, estimatedTime: '< 1 hour', depositMethods: ['bank_transfer'], country: 'BR', currency: 'BRL' },
  },
  DE: {
    tempo: { exchangeRate: 0.92, fee: 1.50, feePercent: 0.003, minAmount: 10, maxAmount: 50000, estimatedTime: '1 business day', depositMethods: ['bank_transfer'], country: 'DE', currency: 'EUR' },
  },
}

export async function fetchAnchorRates(
  country: string,
  currency: string,
  amount: number,
): Promise<AnchorRate[]> {
  // TODO: Replace with real SEP-24 fee endpoint calls
  const countryRates = MOCK_RATES[country] ?? {}
  const results: AnchorRate[] = []

  for (const anchor of KNOWN_ANCHORS) {
    if (!anchor.supportedCountries.includes(country)) continue
    const mockData = countryRates[anchor.id]
    if (!mockData || mockData.exchangeRate === 0) continue

    const totalReceived = computeTotalReceived(
      amount,
      mockData.fee,
      mockData.feePercent,
      mockData.exchangeRate,
    )

    results.push({
      anchorId: anchor.id,
      anchorName: anchor.name,
      ...mockData,
      totalReceived,
      lastUpdated: new Date(),
      isMock: true,
    })
  }

  // Mark best and worst
  if (results.length > 0) {
    const sorted = [...results].sort((a, b) => (b.totalReceived ?? 0) - (a.totalReceived ?? 0))
    sorted[0].isBest = true
    sorted[sorted.length - 1].isWorst = true
  }

  return results
}

export async function fetchOnrampRates(
  country: string,
  currency: string,
  localAmount: number,
): Promise<AnchorRate[]> {
  // MOCK — on-ramp: local currency → USDC
  const offRampRates = await fetchAnchorRates(country, currency, localAmount)
  return offRampRates.map((r) => ({
    ...r,
    // Invert: amount of USDC received for localAmount of fiat
    totalReceived: localAmount / r.exchangeRate - r.fee,
  }))
}
