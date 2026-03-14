import { horizonServer } from './stellar'
import { HORIZON_URL } from '@/constants'
import type { SwapRoute, StellarAsset } from '@/types'

export interface OrderBookData {
  bids: Array<{ price: number; amount: number }>
  asks: Array<{ price: number; amount: number }>
}

export async function getOrderBook(
  sellingAssetCode: string,
  sellingIssuer: string | undefined,
  buyingAssetCode: string,
  buyingIssuer: string | undefined,
): Promise<OrderBookData> {
  const selling =
    sellingAssetCode === 'XLM'
      ? horizonServer.orderbook(
          { code: 'XLM' } as Parameters<typeof horizonServer.orderbook>[0],
          { code: buyingAssetCode, issuer: buyingIssuer ?? '' } as Parameters<typeof horizonServer.orderbook>[1],
        )
      : horizonServer.orderbook(
          { code: sellingAssetCode, issuer: sellingIssuer ?? '' } as Parameters<typeof horizonServer.orderbook>[0],
          buyingAssetCode === 'XLM'
            ? ({ code: 'XLM' } as Parameters<typeof horizonServer.orderbook>[1])
            : ({ code: buyingAssetCode, issuer: buyingIssuer ?? '' } as Parameters<typeof horizonServer.orderbook>[1]),
        )

  const book = await selling.call()

  return {
    bids: (book.bids as Array<{ price: string; amount: string }>).slice(0, 10).map((b) => ({
      price: parseFloat(b.price),
      amount: parseFloat(b.amount),
    })),
    asks: (book.asks as Array<{ price: string; amount: string }>).slice(0, 10).map((a) => ({
      price: parseFloat(a.price),
      amount: parseFloat(a.amount),
    })),
  }
}

export async function getStrictSendPaths(
  fromAsset: StellarAsset,
  fromAmount: number,
  toAssets: StellarAsset[],
): Promise<SwapRoute[]> {
  const url = new URL(`${HORIZON_URL}/paths/strict-send`)
  url.searchParams.set('source_amount', fromAmount.toString())

  if (fromAsset.issuer) {
    url.searchParams.set('source_asset_type', 'credit_alphanum4')
    url.searchParams.set('source_asset_code', fromAsset.code)
    url.searchParams.set('source_asset_issuer', fromAsset.issuer)
  } else {
    url.searchParams.set('source_asset_type', 'native')
  }

  toAssets.forEach((a) => {
    if (a.issuer) {
      url.searchParams.append('destination_assets', `${a.code}:${a.issuer}`)
    } else {
      url.searchParams.append('destination_assets', 'native')
    }
  })

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Horizon paths error: ${res.status}`)
  const data = (await res.json()) as {
    _embedded: {
      records: Array<{
        source_amount: string
        destination_amount: string
        path: Array<{ asset_code?: string; asset_issuer?: string; asset_type: string }>
        source_asset_code?: string
        source_asset_issuer?: string
        destination_asset_code?: string
        destination_asset_issuer?: string
      }>
    }
  }

  const toAsset = toAssets[0]
  const routes: SwapRoute[] = data._embedded.records.map((r, i) => {
    const toAmt = parseFloat(r.destination_amount)
    const fromAmt = parseFloat(r.source_amount)
    const intermediates: StellarAsset[] = r.path.map((p) => ({
      code: p.asset_code ?? 'XLM',
      issuer: p.asset_issuer,
      name: p.asset_code ?? 'XLM',
    }))

    return {
      routeId: `sdex-${i}`,
      source: 'SDEX',
      fromAsset,
      toAsset,
      fromAmount: fromAmt,
      toAmount: toAmt,
      price: toAmt / fromAmt,
      priceImpact: 0.001,
      fee: 0.00001,
      path: [fromAsset, ...intermediates, toAsset],
      estimatedTime: '< 5 seconds',
      lastUpdated: new Date(),
    }
  })

  return routes
}
