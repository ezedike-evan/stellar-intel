import type { SwapRoute, StellarAsset } from '@/types';
import { getStrictSendPaths } from './horizon';

// MOCK — Soroswap, Phoenix, Aquarius: replace when public APIs are stable
function generateMockDexRoutes(
  fromAsset: StellarAsset,
  toAsset: StellarAsset,
  fromAmount: number,
  sdexPrice: number
): SwapRoute[] {
  const variance = (pct: number) => sdexPrice * (1 + pct);
  return [
    {
      routeId: 'soroswap-1',
      source: 'Soroswap',
      fromAsset,
      toAsset,
      fromAmount,
      toAmount: fromAmount * variance(0.002),
      price: variance(0.002),
      priceImpact: 0.002,
      fee: fromAmount * 0.003,
      path: [fromAsset, toAsset],
      estimatedTime: '< 5 seconds',
      lastUpdated: new Date(),
      isMock: true,
    },
    {
      routeId: 'phoenix-1',
      source: 'Phoenix',
      fromAsset,
      toAsset,
      fromAmount,
      toAmount: fromAmount * variance(-0.001),
      price: variance(-0.001),
      priceImpact: 0.0015,
      fee: fromAmount * 0.0025,
      path: [fromAsset, toAsset],
      estimatedTime: '< 5 seconds',
      lastUpdated: new Date(),
      isMock: true,
    },
    {
      routeId: 'aquarius-1',
      source: 'Aquarius',
      fromAsset,
      toAsset,
      fromAmount,
      toAmount: fromAmount * variance(0.0005),
      price: variance(0.0005),
      priceImpact: 0.001,
      fee: fromAmount * 0.002,
      path: [fromAsset, toAsset],
      estimatedTime: '< 5 seconds',
      lastUpdated: new Date(),
      isMock: true,
    },
  ];
}

export async function fetchSwapRoutes(
  fromAsset: StellarAsset,
  toAsset: StellarAsset,
  fromAmount: number
): Promise<SwapRoute[]> {
  let sdexRoutes: SwapRoute[] = [];
  let basePrice = 1;

  try {
    sdexRoutes = await getStrictSendPaths(fromAsset, fromAmount, [toAsset]);
    if (sdexRoutes.length > 0) basePrice = sdexRoutes[0].price;
  } catch {
    // Horizon unavailable — use mock SDEX route
    sdexRoutes = [
      {
        routeId: 'sdex-mock',
        source: 'SDEX',
        fromAsset,
        toAsset,
        fromAmount,
        toAmount: fromAmount * 1.0,
        price: 1.0,
        priceImpact: 0.001,
        fee: 0.00001,
        path: [fromAsset, toAsset],
        estimatedTime: '< 5 seconds',
        lastUpdated: new Date(),
        isMock: true,
      },
    ];
    basePrice = 1.0;
  }

  const mockDexRoutes = generateMockDexRoutes(fromAsset, toAsset, fromAmount, basePrice);
  const all = [...sdexRoutes, ...mockDexRoutes].sort((a, b) => b.toAmount - a.toAmount);

  if (all.length > 0) all[0].isBest = true;
  return all;
}
