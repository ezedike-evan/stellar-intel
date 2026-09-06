import { describe, it, expect, vi } from 'vitest';
import { planHopChain, executeHopChain } from '@/lib/router/hops';
import type { Hop, HopAsset, HopStep, HopPlanResult, HopExecutionResult } from '@/types';

// ─── Test utilities ───────────────────────────────────────────────────────────

/** A mock on-ramp hop: fiat NGN in, USDC out, at a fixed rate minus a flat fee. */
function makeOnRampHop(overrides?: Partial<Hop>): Hop {
  return {
    type: 'on-ramp',
    id: 'mock-on-ramp',
    async plan(input: HopAsset): Promise<HopPlanResult> {
      const ngn = Number(input.amount);
      const usdc = ngn / 1500 - 1; // flat 1 USDC fee after conversion
      if (usdc <= 0) {
        return { ok: false, hopId: 'mock-on-ramp', error: 'amount_too_small' };
      }
      const step: HopStep = {
        hopType: 'on-ramp',
        hopId: 'mock-on-ramp',
        input,
        output: { asset: 'stellar:USDC:GISSUER', amount: usdc.toFixed(7) },
        details: { anchorId: 'mock-anchor' },
      };
      return { ok: true, step };
    },
    async execute(step: HopStep): Promise<HopExecutionResult> {
      return { ok: true, hopId: 'mock-on-ramp', output: step.output, txRef: 'sep24-tx-1' };
    },
    ...overrides,
  };
}

/** A mock swap hop: USDC in, XLM out, at a fixed rate. */
function makeSwapHop(overrides?: Partial<Hop>): Hop {
  return {
    type: 'swap',
    id: 'mock-swap',
    async plan(input: HopAsset): Promise<HopPlanResult> {
      const usdc = Number(input.amount);
      const xlm = usdc * 10;
      const step: HopStep = {
        hopType: 'swap',
        hopId: 'mock-swap',
        input,
        output: { asset: 'stellar:native', amount: xlm.toFixed(7) },
        details: { poolId: 'mock-pool' },
      };
      return { ok: true, step };
    },
    async execute(step: HopStep): Promise<HopExecutionResult> {
      return { ok: true, hopId: 'mock-swap', output: step.output, txRef: 'soroban-tx-1' };
    },
    ...overrides,
  };
}

const ngnInput: HopAsset = { asset: 'iso4217:NGN', amount: '150000' };

// ─── planHopChain ──────────────────────────────────────────────────────────────

describe('planHopChain', () => {
  it('composes two hops, threading the first hop output into the second hop input', async () => {
    const onRamp = makeOnRampHop();
    const swap = makeSwapHop();

    const result = await planHopChain([onRamp, swap], ngnInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.steps).toHaveLength(2);
    expect(result.plan.steps[0]?.hopId).toBe('mock-on-ramp');
    expect(result.plan.steps[0]?.input).toEqual(ngnInput);
    expect(result.plan.steps[1]?.hopId).toBe('mock-swap');
    // Second hop's input is exactly the first hop's output — proves composability.
    expect(result.plan.steps[1]?.input).toEqual(result.plan.steps[0]?.output);
    expect(result.plan.finalOutput).toEqual(result.plan.steps[1]?.output);
  });

  it('composes three hops in sequence', async () => {
    const onRamp = makeOnRampHop();
    const swap = makeSwapHop();
    const yieldHop = makeSwapHop({
      type: 'yield',
      id: 'mock-yield',
      plan: async (input) => ({
        ok: true,
        step: {
          hopType: 'yield',
          hopId: 'mock-yield',
          input,
          output: { asset: 'stellar:yXLM:GPOOL', amount: input.amount },
          details: { poolId: 'mock-yield-pool' },
        },
      }),
    });

    const result = await planHopChain([onRamp, swap, yieldHop], ngnInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.steps.map((s) => s.hopId)).toEqual([
      'mock-on-ramp',
      'mock-swap',
      'mock-yield',
    ]);
    expect(result.plan.finalOutput.asset).toBe('stellar:yXLM:GPOOL');
  });

  it('aborts the whole chain before any hop runs when a hop fails to plan', async () => {
    const onRamp = makeOnRampHop();
    const swapExecute = vi.fn();
    const failingSwap = makeSwapHop({
      plan: async () => ({ ok: false, hopId: 'mock-swap', error: 'no_route', details: 'no pool' }),
      execute: swapExecute,
    });

    const result = await planHopChain([onRamp, failingSwap], ngnInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedHopId).toBe('mock-swap');
    expect(result.error).toBe('no_route');
    expect(result.completedSteps).toHaveLength(1);
    expect(result.completedSteps[0]?.hopId).toBe('mock-on-ramp');
    expect(swapExecute).not.toHaveBeenCalled();
  });

  it('rejects an empty chain', async () => {
    const result = await planHopChain([], ngnInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('empty_chain');
  });
});

// ─── executeHopChain ───────────────────────────────────────────────────────────

describe('executeHopChain', () => {
  it('executes every step of a planned chain in order', async () => {
    const onRamp = makeOnRampHop();
    const swap = makeSwapHop();
    const planned = await planHopChain([onRamp, swap], ngnInput);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const result = await executeHopChain(planned.plan, [onRamp, swap]);

    expect(result.ok).toBe(true);
    expect(result.completed).toHaveLength(2);
    expect(result.completed[0]).toMatchObject({ ok: true, hopId: 'mock-on-ramp' });
    expect(result.completed[1]).toMatchObject({ ok: true, hopId: 'mock-swap' });
  });

  it('stops at the first execution failure without running the remaining hops', async () => {
    const onRamp = makeOnRampHop();
    const swapExecute = vi.fn(
      async (): Promise<HopExecutionResult> => ({
        ok: false,
        hopId: 'mock-swap',
        error: 'slippage_exceeded',
      })
    );
    const swap = makeSwapHop({ execute: swapExecute });
    const thirdHopExecute = vi.fn();
    const yieldHop = makeSwapHop({
      type: 'yield',
      id: 'mock-yield',
      execute: thirdHopExecute,
    });

    const planned = await planHopChain([onRamp, swap, yieldHop], ngnInput);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const result = await executeHopChain(planned.plan, [onRamp, swap, yieldHop]);

    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe('mock-swap');
    expect(result.completed).toHaveLength(2);
    expect(thirdHopExecute).not.toHaveBeenCalled();
  });

  it('fails a step whose hop implementation is not registered at execute time', async () => {
    const onRamp = makeOnRampHop();
    const swap = makeSwapHop();
    const planned = await planHopChain([onRamp, swap], ngnInput);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    // Only the on-ramp hop is registered for execution — the swap hop is missing.
    const result = await executeHopChain(planned.plan, [onRamp]);

    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe('mock-swap');
    expect(result.completed[1]).toMatchObject({ ok: false, error: 'hop_not_registered' });
  });
});
