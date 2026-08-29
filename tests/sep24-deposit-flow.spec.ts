import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as sep24 from '@/lib/stellar/sep24';
import { Sep24DepositError } from '@/lib/stellar/sep24';
import type { ResolvedAnchor } from '@/types';
import {
  DEPOSIT_INTERACTIVE_URL,
  DEPOSIT_INTERACTIVE_URL_WITH_QUERY,
  MOCK_DEPOSIT_CALLBACK_URL,
  MOCK_DEPOSIT_JWT,
  MOCK_DEPOSIT_TRANSACTION_ID,
  MOCK_DEPOSIT_TRANSFER_SERVER,
  depositAnchor,
  depositAnchorWithoutSep24,
  depositErrorBody,
  depositFlowParams,
  depositNonInteractiveResponse,
  makeDepositInteractiveResponse,
  makeFetchResponse,
} from './fixtures/sep24-deposit';

/**
 * Specification for the SEP-24 interactive deposit flow, written ahead of the
 * implementation (#1092) so the feature has something to build against.
 *
 * `initiateDeposit` already covers a single call to the anchor. What is missing
 * is the orchestration around it: the preconditions that must be checked before
 * a request is made, and the deposit URL the user is actually sent to once the
 * anchor has issued one. `startDepositFlow` is that orchestration.
 *
 * THE SUITE IS SKIPPED until `startDepositFlow` lands in `lib/stellar/sep24.ts`,
 * next to `initiateDeposit`. Remove the `.skip` below — nothing else — once it
 * exports the contract described by `StartDepositFlow` and `DepositFlowSession`.
 */

// ─── Contract under specification ─────────────────────────────────────────────

/** Everything the caller supplies to start a deposit. */
interface DepositFlowParams {
  /** SEP-10 session token for the anchor. */
  jwt: string;
  assetCode: string;
  assetIssuer: string;
  amount: string;
  /** Stellar account credited when the deposit completes. */
  account: string;
  /** Where the anchor should return the user after the interactive step. */
  callbackUrl?: string;
  /** BCP 47 language tag for the interactive UI. Defaults to `en`. */
  lang?: string;
}

/** What the caller needs in order to hand the user off to the anchor. */
interface DepositFlowSession {
  /** Anchor-issued transaction id, used for subsequent status polling. */
  transactionId: string;
  /** The URL to open, with the callback and language applied. */
  depositUrl: string;
  /** Transfer server the session was opened against. */
  transferServer: string;
}

type StartDepositFlow = (
  anchor: ResolvedAnchor,
  params: DepositFlowParams,
  signal?: AbortSignal
) => Promise<DepositFlowSession>;

/**
 * Resolved through the module namespace rather than a named import: the export
 * does not exist yet, and a named import would stop this file from compiling
 * and loading while the suite is skipped.
 */
function startDepositFlow(
  anchor: ResolvedAnchor,
  params: DepositFlowParams,
  signal?: AbortSignal
): Promise<DepositFlowSession> {
  const fn = (sep24 as unknown as Record<string, unknown>)['startDepositFlow'];
  if (typeof fn !== 'function') {
    return Promise.reject(
      new Error('startDepositFlow is not implemented yet — un-skip this suite once it lands')
    );
  }
  return (fn as StartDepositFlow)(anchor, params, signal);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Stubs fetch with a single response and records how it was called. */
function stubFetch(response: unknown): { calls: Array<[string, RequestInit]> } {
  const calls: Array<[string, RequestInit]> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, opts: RequestInit = {}) => {
      calls.push([url, opts]);
      return response;
    })
  );
  return { calls };
}

/** The interactive POST, ignoring any /info lookup the flow makes first. */
function interactiveCall(calls: Array<[string, RequestInit]>): [string, RequestInit] {
  const call = calls.find(([url]) => url.includes('/transactions/deposit/interactive'));
  expect(call, 'expected a POST to /transactions/deposit/interactive').toBeDefined();
  return call as [string, RequestInit];
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.skip('startDepositFlow', () => {
  // ─── Preconditions ──────────────────────────────────────────────────────────

  describe('preconditions', () => {
    it('rejects an anchor that does not support SEP-24 deposits', async () => {
      const { calls } = stubFetch(makeFetchResponse(makeDepositInteractiveResponse()));

      await expect(startDepositFlow(depositAnchorWithoutSep24, depositFlowParams)).rejects.toThrow(
        /does not support SEP-24/
      );
      expect(calls).toHaveLength(0);
    });

    it('rejects before contacting the anchor when the amount is not positive', async () => {
      const { calls } = stubFetch(makeFetchResponse(makeDepositInteractiveResponse()));

      await expect(
        startDepositFlow(depositAnchor, { ...depositFlowParams, amount: '0' })
      ).rejects.toThrow(/amount/i);
      expect(calls).toHaveLength(0);
    });
  });

  // ─── Interactive handshake ──────────────────────────────────────────────────

  describe('interactive handshake', () => {
    it('POSTs to the anchor deposit interactive endpoint', async () => {
      const { calls } = stubFetch(makeFetchResponse(makeDepositInteractiveResponse()));

      await startDepositFlow(depositAnchor, depositFlowParams);

      const [url, opts] = interactiveCall(calls);
      expect(url).toBe(`${MOCK_DEPOSIT_TRANSFER_SERVER}/transactions/deposit/interactive`);
      expect(opts.method).toBe('POST');
    });

    it('authenticates with the SEP-10 session token', async () => {
      const { calls } = stubFetch(makeFetchResponse(makeDepositInteractiveResponse()));

      await startDepositFlow(depositAnchor, depositFlowParams);

      const [, opts] = interactiveCall(calls);
      const headers = opts.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Bearer ${MOCK_DEPOSIT_JWT}`);
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('sends the asset, amount, and destination account in the body', async () => {
      const { calls } = stubFetch(makeFetchResponse(makeDepositInteractiveResponse()));

      await startDepositFlow(depositAnchor, depositFlowParams);

      const [, opts] = interactiveCall(calls);
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body['asset_code']).toBe(depositFlowParams.assetCode);
      expect(body['asset_issuer']).toBe(depositFlowParams.assetIssuer);
      expect(body['amount']).toBe(depositFlowParams.amount);
      expect(body['account']).toBe(depositFlowParams.account);
    });

    it('defaults the interactive language to en and honours an override', async () => {
      const first = stubFetch(makeFetchResponse(makeDepositInteractiveResponse()));
      await startDepositFlow(depositAnchor, depositFlowParams);
      expect(
        (JSON.parse(interactiveCall(first.calls)[1].body as string) as Record<string, unknown>)[
          'lang'
        ]
      ).toBe('en');

      const second = stubFetch(makeFetchResponse(makeDepositInteractiveResponse()));
      await startDepositFlow(depositAnchor, { ...depositFlowParams, lang: 'fr' });
      expect(
        (JSON.parse(interactiveCall(second.calls)[1].body as string) as Record<string, unknown>)[
          'lang'
        ]
      ).toBe('fr');
    });

    it('forwards an AbortSignal so a cancelled flow cancels the request', async () => {
      const { calls } = stubFetch(makeFetchResponse(makeDepositInteractiveResponse()));
      const controller = new AbortController();

      await startDepositFlow(depositAnchor, depositFlowParams, controller.signal);

      const [, opts] = interactiveCall(calls);
      expect(opts.signal).toBe(controller.signal);
    });
  });

  // ─── Deposit URL ────────────────────────────────────────────────────────────

  describe('deposit URL', () => {
    it('returns the transaction id, deposit URL, and transfer server', async () => {
      stubFetch(makeFetchResponse(makeDepositInteractiveResponse()));

      const session = await startDepositFlow(depositAnchor, depositFlowParams);

      expect(session.transactionId).toBe(MOCK_DEPOSIT_TRANSACTION_ID);
      expect(session.depositUrl).toBe(DEPOSIT_INTERACTIVE_URL);
      expect(session.transferServer).toBe(MOCK_DEPOSIT_TRANSFER_SERVER);
    });

    it('appends the callback URL when one is supplied', async () => {
      stubFetch(makeFetchResponse(makeDepositInteractiveResponse()));

      const session = await startDepositFlow(depositAnchor, {
        ...depositFlowParams,
        callbackUrl: MOCK_DEPOSIT_CALLBACK_URL,
      });

      expect(new URL(session.depositUrl).searchParams.get('callback')).toBe(
        MOCK_DEPOSIT_CALLBACK_URL
      );
    });

    it('preserves query parameters the anchor already put on the URL', async () => {
      stubFetch(
        makeFetchResponse(makeDepositInteractiveResponse(DEPOSIT_INTERACTIVE_URL_WITH_QUERY))
      );

      const session = await startDepositFlow(depositAnchor, {
        ...depositFlowParams,
        callbackUrl: MOCK_DEPOSIT_CALLBACK_URL,
      });

      const params = new URL(session.depositUrl).searchParams;
      expect(params.get('token')).toBe('abc');
      expect(params.get('step')).toBe('kyc');
      expect(params.get('callback')).toBe(MOCK_DEPOSIT_CALLBACK_URL);
    });

    it('leaves the anchor URL untouched when no callback is supplied', async () => {
      stubFetch(
        makeFetchResponse(makeDepositInteractiveResponse(DEPOSIT_INTERACTIVE_URL_WITH_QUERY))
      );

      const session = await startDepositFlow(depositAnchor, depositFlowParams);

      expect(session.depositUrl).toBe(DEPOSIT_INTERACTIVE_URL_WITH_QUERY);
    });
  });

  // ─── Anchor failures ────────────────────────────────────────────────────────

  describe('anchor failures', () => {
    it('surfaces a Sep24DepositError carrying the status and anchor body', async () => {
      stubFetch(makeFetchResponse(depositErrorBody, { ok: false, status: 403 }));

      const error = await startDepositFlow(depositAnchor, depositFlowParams).catch(
        (e: unknown) => e
      );

      expect(error).toBeInstanceOf(Sep24DepositError);
      expect((error as Sep24DepositError).status).toBe(403);
      expect((error as Sep24DepositError).anchorBody).toEqual(depositErrorBody);
    });

    it('rejects when the anchor cannot run an interactive deposit', async () => {
      stubFetch(makeFetchResponse(depositNonInteractiveResponse));

      await expect(startDepositFlow(depositAnchor, depositFlowParams)).rejects.toThrow(
        /Unexpected response type/
      );
    });

    it('rejects when the anchor omits the deposit URL', async () => {
      const { url: _omit, ...withoutUrl } = makeDepositInteractiveResponse();
      stubFetch(makeFetchResponse(withoutUrl));

      await expect(startDepositFlow(depositAnchor, depositFlowParams)).rejects.toThrow(/"url"/);
    });

    it('rejects when the anchor omits the transaction id', async () => {
      const { id: _omit, ...withoutId } = makeDepositInteractiveResponse();
      stubFetch(makeFetchResponse(withoutId));

      await expect(startDepositFlow(depositAnchor, depositFlowParams)).rejects.toThrow(/"id"/);
    });
  });
});
