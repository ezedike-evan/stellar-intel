import type { SoroswapQuote, SoroswapBuildResult } from '@/lib/stellar/soroswap';

export const USDC_CONTRACT = 'CBBHRKEP5M3NUDRISGLJKGHDHX3DA2CN2AZBQY6WLVUJ7VNLGSKBDUCM';
export const XLM_CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

export const MOCK_QUOTE_RESPONSE: SoroswapQuote = {
  amountIn: '1000000000',
  amountOut: '10000000000',
  price: '10.0',
};

export const MOCK_BUILD_RESPONSE: SoroswapBuildResult = {
  xdr: 'AAAAAgAAAAA=',
};

export const MOCK_ERROR_RESPONSES = {
  internalServerError500: {
    status: 500,
    body: { message: 'Internal server error in Soroswap routing engine' },
  },
  serviceUnavailable503: {
    status: 503,
    body: { message: 'Soroswap liquidity provider unavailable' },
  },
  unprocessableEntity422: {
    status: 422,
    body: { message: 'Insufficient liquidity for swap route' },
  },
  badRequest400: {
    status: 400,
    body: { message: 'Invalid asset contract parameters' },
  },
};
