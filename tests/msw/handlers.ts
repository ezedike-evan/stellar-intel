import { http, HttpResponse } from 'msw';

/**
 * MSW handlers for cowrie.exchange — mocks the SEP-6 /info endpoint so that
 * integration tests can exercise the full getSep6Info → server-rates pipeline
 * without real network I/O.
 *
 * TRANSFER_SERVER = https://cowrie.exchange/sep6, so /info resolves to the
 * path below. The TOML is mocked at the resolveAnchor level (stellar-sdk's
 * StellarToml.Resolver does not use global fetch and is not interceptable by MSW).
 */
export const cowrieHandlers = [
  http.get('https://cowrie.exchange/sep6/info', () => {
    return HttpResponse.json({
      withdraw: {
        USDC: {
          enabled: true,
          fee_fixed: 2,
          fee_percent: 0,
          min_amount: 10,
          max_amount: 10000,
          fields: {},
        },
      },
    });
  }),
];
