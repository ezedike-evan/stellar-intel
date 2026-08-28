/**
 * tests/router-hop-chain-failure-messages.spec.ts
 *
 * What the user is told when a hop fails mid-route (#1090). A multi-hop
 * chain can fail after earlier hops already executed and moved real funds
 * -- executeHopChain's message must say what completed (with a reference),
 * what failed and why, and what the user should do next, at every hop
 * boundary. No failure path should ever collapse to a bare error code.
 */

import { describe, it, expect } from 'vitest';
import { planHopChain, executeHopChain } from '@/lib/router/hops';
import type { Hop, HopAsset, HopExecutionResult, HopPlanResult, HopStep } from '@/types';

/** A mock hop whose plan always succeeds and whose execute result is fixed. */
function mockHop(
  type: Hop['type'],
  id: string,
  output: HopAsset,
  executionResult: HopExecutionResult
): Hop {
  return {
    type,
    id,
    async plan(input: HopAsset): Promise<HopPlanResult> {
      const step: HopStep = { hopType: type, hopId: id, input, output, details: {} };
      return { ok: true, step };
    },
    async execute(): Promise<HopExecutionResult> {
      return executionResult;
    },
  };
}

const ngnInput: HopAsset = { asset: 'iso4217:NGN', amount: '150000' };
const usdcOut: HopAsset = { asset: 'stellar:USDC:GISSUER', amount: '99.5' };
const xlmOut: HopAsset = { asset: 'stellar:native', amount: '995' };
const yieldOut: HopAsset = { asset: 'stellar:yXLM:GPOOL', amount: '995' };

describe('executeHopChain — what the user is told when a hop fails mid-route (#1090)', () => {
  it('fails at the first hop boundary: nothing completed, message says it is safe to retry', async () => {
    const onRamp = mockHop('on-ramp', 'on-ramp-1', usdcOut, {
      ok: false,
      hopId: 'on-ramp-1',
      error: 'no_exchange_rate',
      details: 'cowrie returned a zero or missing exchange rate for a NGN deposit',
    });

    const planned = await planHopChain([onRamp], ngnInput);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const result = await executeHopChain(planned.plan, [onRamp]);

    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe('on-ramp-1');
    expect(result.message).toBeTruthy();
    const message = result.message!;

    // States what failed, and why -- the connector's own error, not a generic wrapper.
    expect(message).toMatch(/on-ramp-1/);
    expect(message).toMatch(/no_exchange_rate/);
    expect(message).toMatch(/zero or missing exchange rate/);
    // Nothing completed, and the message says so.
    expect(message).toMatch(/nothing.*executed yet/i);
    expect(message).toMatch(/safe to retry/i);
    // Never a bare/generic message.
    expect(message).not.toBe('The route failed for an unspecified reason.');
    expect(message.length).toBeGreaterThan(40);
  });

  it('fails at the second hop boundary of a 2-hop chain: names what completed and what to do', async () => {
    const onRamp = mockHop('on-ramp', 'on-ramp-1', usdcOut, {
      ok: true,
      hopId: 'on-ramp-1',
      output: usdcOut,
      txRef: 'sep24-tx-42',
    });
    const swap = mockHop('swap', 'swap-1', xlmOut, {
      ok: false,
      hopId: 'swap-1',
      error: 'no_route',
      details: 'Soroswap quote failed with HTTP 422',
    });

    const planned = await planHopChain([onRamp, swap], ngnInput);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const result = await executeHopChain(planned.plan, [onRamp, swap]);

    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe('swap-1');
    const message = result.message!;

    // What completed, with its reference -- real funds already moved.
    expect(message).toMatch(/on-ramp-1/);
    expect(message).toMatch(/99\.5/);
    expect(message).toMatch(/sep24-tx-42/);
    // What did not, and why.
    expect(message).toMatch(/swap-1/);
    expect(message).toMatch(/no_route/);
    expect(message).toMatch(/HTTP 422/);
    // What the user should do.
    expect(message).toMatch(/do not repeat/i);
    expect(message).toMatch(/contact support/i);
  });

  it('fails at the third hop boundary of a 3-hop chain: both completed steps are named', async () => {
    const onRamp = mockHop('on-ramp', 'on-ramp-1', usdcOut, {
      ok: true,
      hopId: 'on-ramp-1',
      output: usdcOut,
      txRef: 'sep24-tx-42',
    });
    const swap = mockHop('swap', 'swap-1', xlmOut, {
      ok: true,
      hopId: 'swap-1',
      output: xlmOut,
      txRef: 'soroban-tx-7',
    });
    const yieldHop = mockHop('yield', 'yield-1', yieldOut, {
      ok: false,
      hopId: 'yield-1',
      error: 'pool_load_failed',
      details: 'Blend reserve lookup timed out after 8000ms',
    });

    const planned = await planHopChain([onRamp, swap, yieldHop], ngnInput);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const result = await executeHopChain(planned.plan, [onRamp, swap, yieldHop]);

    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe('yield-1');
    const message = result.message!;

    expect(message).toMatch(/on-ramp-1/);
    expect(message).toMatch(/sep24-tx-42/);
    expect(message).toMatch(/swap-1/);
    expect(message).toMatch(/soroban-tx-7/);
    expect(message).toMatch(/yield-1/);
    expect(message).toMatch(/pool_load_failed/);
    expect(message).toMatch(/Blend reserve lookup timed out/);
    expect(message).toMatch(/do not repeat/i);
  });

  it('names the missing connector, not a generic error, when a planned hop has no registered implementation', async () => {
    const onRamp = mockHop('on-ramp', 'on-ramp-1', usdcOut, {
      ok: true,
      hopId: 'on-ramp-1',
      output: usdcOut,
      txRef: 'sep24-tx-42',
    });
    const swap = mockHop('swap', 'swap-1', xlmOut, {
      ok: true,
      hopId: 'swap-1',
      output: xlmOut,
    });

    const planned = await planHopChain([onRamp, swap], ngnInput);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    // Only the on-ramp hop is registered for execution -- the swap hop is missing.
    const result = await executeHopChain(planned.plan, [onRamp]);

    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe('swap-1');
    const message = result.message!;

    expect(message).toMatch(/on-ramp-1/);
    expect(message).toMatch(/swap-1/);
    expect(message).toMatch(/no hop implementation registered/i);
    expect(message).toMatch(/do not repeat/i);
  });

  it('never produces a generic error across every hop-boundary failure', async () => {
    const genericPhrases = [/^error$/i, /^something went wrong$/i, /^failed$/i, /^unknown error$/i];

    const scenarios: Array<{ hops: Hop[] }> = [
      {
        hops: [
          mockHop('swap', 'swap-only', xlmOut, {
            ok: false,
            hopId: 'swap-only',
            error: 'invalid_quote',
            details: 'Soroswap returned a non-positive amountOut: "-1"',
          }),
        ],
      },
      {
        hops: [
          mockHop('on-ramp', 'on-ramp-a', usdcOut, {
            ok: true,
            hopId: 'on-ramp-a',
            output: usdcOut,
            txRef: 'sep24-tx-99',
          }),
          mockHop('yield', 'yield-b', yieldOut, {
            ok: false,
            hopId: 'yield-b',
            error: 'reserve_not_found',
            details: 'No reserve for asset stellar:USDC:GISSUER in pool CPOOLID',
          }),
        ],
      },
    ];

    for (const { hops } of scenarios) {
      const planned = await planHopChain(hops, ngnInput);
      expect(planned.ok).toBe(true);
      if (!planned.ok) continue;

      const result = await executeHopChain(planned.plan, hops);
      expect(result.ok).toBe(false);

      const message = result.message ?? '';
      expect(message.length).toBeGreaterThan(0);
      for (const generic of genericPhrases) {
        expect(message.trim()).not.toMatch(generic);
      }
    }
  });
});
