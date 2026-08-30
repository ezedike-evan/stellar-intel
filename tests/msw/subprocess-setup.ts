import { setupServer } from 'msw/node';
import { cowrieHandlers } from './handlers';
import { StellarToml } from '@stellar/stellar-sdk';
import { http, HttpResponse } from 'msw';

const start = Date.now();
const logReq = (label) => console.log(`[${Date.now() - start}ms] MSW: ${label}`);

// 1. MSW intercepts all global fetch/http calls (including axios used by StellarToml)
const server = setupServer(
  ...cowrieHandlers,
  // Catch all TOML requests to prevent long retries
  http.get(/.well-known\/stellar\.toml$/, ({ request }) => {
    logReq(`TOML ${request.url}`);
    if (request.url.includes('cowrie')) {
      return HttpResponse.text(`
TRANSFER_SERVER="https://cowrie.exchange/sep6"
TRANSFER_SERVER_SEP0024="https://cowrie.exchange/sep24"
ANCHOR_QUOTE_SERVER="https://cowrie.exchange/sep38"
      `);
    }
    // For other anchors (e.g. moneygram), return empty to bail out quickly
    return HttpResponse.text('');
  }),
  // FX reference rate
  http.get('https://open.er-api.com/v6/latest/USD', () => {
    logReq('FX open.er-api.com');
    return HttpResponse.json({ result: 'success', rates: { NGN: 1600 } });
  }),
  // Cowrie SEP-38 /info
  http.get('https://cowrie.exchange/sep38/info', () => {
    logReq('SEP-38 /info');
    return HttpResponse.json({
      assets: [{ asset: 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' }]
    });
  }),
  // Cowrie SEP-38 /prices
  http.get('https://cowrie.exchange/sep38/prices', () => {
    logReq('SEP-38 /prices');
    return HttpResponse.json({
      buy_assets: [
        {
          asset: 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          price: '1600'
        }
      ]
    });
  }),
  // Cowrie SEP-38 /price
  http.get('https://cowrie.exchange/sep38/price', () => {
    logReq('SEP-38 /price');
    return HttpResponse.json({
      price: '1600',
      sell_amount: '100',
      buy_amount: '160000',
      fee_total: '0'
    });
  }),
  // Catch-all for other cowrie endpoints to prevent real network hangs
  http.get('https://cowrie.exchange/*', ({ request }) => {
    logReq(`Catch-all cowrie ${request.url}`);
    return HttpResponse.json({});
  }),
  // Catch-all to prevent ANY real network requests from hanging the test
  http.get('*', ({ request }) => {
    // Only bypass if it's localhost (e.g. MCP transport) or other necessary
    if (request.url.includes('localhost') || request.url.includes('127.0.0.1')) {
      return; // Bypass
    }
    logReq(`Catch-all 404 ${request.url}`);
    return HttpResponse.json({}, { status: 404 });
  })
);

server.listen({ onUnhandledRequest: 'bypass' });
