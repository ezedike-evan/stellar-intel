import { describe, it, expect } from 'vitest';
import {
  solveChain,
  type Hop,
  type HopExecutor,
  type PlannedHop,
  type ChainedPlan,
} from '@/lib/router/solve';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeExecutor(
  kind: HopExecutor['kind'],
  executorId: string,
  estimatedOut: string,
  fee = '0'
): HopExecutor {
  return {
    kind,
    executorId,
    async planHop(hop: Hop): Promise<PlannedHop | null> {
      return { hop, executorId, estimatedOut, fee };
    },
  };
}

function rejectingExecutor(kind: HopExecutor['kind']): HopExecutor {
  return {
    kind,
    executorId: 'rejector',
    async planHop(): Promise<null> {
      return null;
    },
  };
}

const USDT: Hop['sellAsset'] = { code: 'USDT' };
const USDC: Hop['sellAsset'] = { code: 'USDC' };
const XLM: Hop['sellAsset'] = { code: 'XLM' };
const NGN: Hop['sellAsset'] = { code: 'NGN' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('solveChain — hop chain architecture (#815)', () => {
  it('rejects an empty chain', async () => {
    const result = await solveChain([], [makeExecutor('on-ramp', 'a', '100')]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('empty_chain');
  });

  it('solves a single hop', async () => {
    const hop: Hop = { kind: 'swap', sellAsset: USDC, buyAsset: XLM, minReceive: '10' };
    const result = await solveChain([hop], [makeExecutor('swap', 'soroswap', '50', '1')]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.type).toBe('chained');
    expect(result.plan.hops).toHaveLength(1);
    expect(result.plan.hops[0]!.executorId).toBe('soroswap');
    expect(result.plan.totalEstimatedOut).toBe('50');
  });

  it('solves a 2-hop on-ramp -> swap chain', async () => {
    const hops: Hop[] = [
      { kind: 'on-ramp', sellAsset: USDT, buyAsset: USDC, minReceive: '99' },
      { kind: 'swap', sellAsset: USDC, buyAsset: XLM, minReceive: '400' },
    ];
    const executors: HopExecutor[] = [
      makeExecutor('on-ramp', 'cowrie', '99.5', '0.5'),
      makeExecutor('swap', 'soroswap', '420', '1'),
    ];

    const result = await solveChain(hops, executors);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const plan = result.plan as ChainedPlan;
    expect(plan.type).toBe('chained');
    expect(plan.hops).toHaveLength(2);
    expect(plan.hops[0]!.executorId).toBe('cowrie');
    expect(plan.hops[0]!.estimatedOut).toBe('99.5');
    expect(plan.hops[1]!.executorId).toBe('soroswap');
    expect(plan.hops[1]!.estimatedOut).toBe('420');
    expect(plan.totalEstimatedOut).toBe('420');
  });

  it('solves a 2-hop swap -> yield chain', async () => {
    const hops: Hop[] = [
      { kind: 'swap', sellAsset: USDC, buyAsset: XLM, minReceive: '400' },
      { kind: 'yield', sellAsset: XLM, buyAsset: XLM, minReceive: '400' },
    ];
    const executors: HopExecutor[] = [
      makeExecutor('swap', 'soroswap', '420', '1'),
      makeExecutor('yield', 'blend-protocol', '422', '0'),
    ];

    const result = await solveChain(hops, executors);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.hops).toHaveLength(2);
    expect(result.plan.hops[1]!.executorId).toBe('blend-protocol');
    expect(result.plan.totalEstimatedOut).toBe('422');
  });

  it('rejects a chain with an asset mismatch between hops', async () => {
    const hops: Hop[] = [
      { kind: 'on-ramp', sellAsset: USDT, buyAsset: USDC, minReceive: '99' },
      { kind: 'swap', sellAsset: NGN, buyAsset: XLM, minReceive: '400' },
    ];

    const result = await solveChain(hops, [
      makeExecutor('on-ramp', 'cowrie', '99.5'),
      makeExecutor('swap', 'soroswap', '420'),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok || result.error !== 'asset_mismatch') return;
    expect(result.hopIndex).toBe(1);
    expect(result.details).toMatch(/USDC/);
    expect(result.details).toMatch(/NGN/);
  });

  it('asset matching is case-insensitive', async () => {
    const hops: Hop[] = [
      { kind: 'swap', sellAsset: { code: 'usdc' }, buyAsset: { code: 'xlm' }, minReceive: '1' },
      { kind: 'yield', sellAsset: { code: 'XLM' }, buyAsset: { code: 'XLM' }, minReceive: '1' },
    ];
    const result = await solveChain(hops, [
      makeExecutor('swap', 'soroswap', '10'),
      makeExecutor('yield', 'blend', '10'),
    ]);
    expect(result.ok).toBe(true);
  });

  it('returns no_route_for_hop when no executor matches', async () => {
    const hops: Hop[] = [
      { kind: 'on-ramp', sellAsset: USDT, buyAsset: USDC, minReceive: '99' },
      { kind: 'swap', sellAsset: USDC, buyAsset: XLM, minReceive: '400' },
    ];

    const result = await solveChain(hops, [
      makeExecutor('on-ramp', 'cowrie', '99.5'),
      rejectingExecutor('swap'),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok || result.error !== 'no_route_for_hop') return;
    expect(result.hopIndex).toBe(1);
  });

  it('falls back to the next eligible executor when the first rejects', async () => {
    const hop: Hop = { kind: 'swap', sellAsset: USDC, buyAsset: XLM, minReceive: '1' };
    const result = await solveChain(
      [hop],
      [rejectingExecutor('swap'), makeExecutor('swap', 'fallback-dex', '15')]
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.hops[0]!.executorId).toBe('fallback-dex');
  });

  it('issuer mismatch on same code is rejected as asset_mismatch', async () => {
    const usdcA: Hop['buyAsset'] = {
      code: 'USDC',
      issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4MY5KU4ERRJLSORRQ7ROVQA5SV6LQ34',
    };
    const usdcB: Hop['sellAsset'] = {
      code: 'USDC',
      issuer: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    };
    const hops: Hop[] = [
      { kind: 'on-ramp', sellAsset: USDT, buyAsset: usdcA, minReceive: '99' },
      { kind: 'swap', sellAsset: usdcB, buyAsset: XLM, minReceive: '400' },
    ];

    const result = await solveChain(hops, [
      makeExecutor('on-ramp', 'cowrie', '99'),
      makeExecutor('swap', 'dex', '400'),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('asset_mismatch');
    // narrowed for type safety — hopIndex access confirmed above
  });

  it('solves a 2-hop swap -> off-ramp chain and aggregates fees', async () => {
    const hops: Hop[] = [
      { kind: 'swap', sellAsset: USDC, buyAsset: XLM, minReceive: '400' },
      { kind: 'off-ramp', sellAsset: XLM, buyAsset: NGN, minReceive: '60000' },
    ];
    const executors: HopExecutor[] = [
      makeExecutor('swap', 'soroswap', '420', '1'),
      makeExecutor('off-ramp', 'cowrie-out', '63000', '10'),
    ];

    const result = await solveChain(hops, executors);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const plan = result.plan as ChainedPlan;
    expect(plan.type).toBe('chained');
    expect(plan.hops).toHaveLength(2);

    expect(plan.hops[0]!.executorId).toBe('soroswap');
    expect(plan.hops[0]!.estimatedOut).toBe('420');
    expect(plan.hops[0]!.fee).toBe('1');

    expect(plan.hops[1]!.executorId).toBe('cowrie-out');
    expect(plan.hops[1]!.estimatedOut).toBe('63000');
    expect(plan.hops[1]!.fee).toBe('10');

    expect(plan.totalEstimatedOut).toBe('63000');
    const totalFee = plan.hops.reduce((sum, h) => sum + Number(h.fee), 0);
    expect(totalFee).toBe(11);
  });

  it('reports no_route_for_hop when the off-ramp executor rejects', async () => {
    const hops: Hop[] = [
      { kind: 'swap', sellAsset: USDC, buyAsset: XLM, minReceive: '400' },
      { kind: 'off-ramp', sellAsset: XLM, buyAsset: NGN, minReceive: '60000' },
    ];

    const result = await solveChain(hops, [
      makeExecutor('swap', 'soroswap', '420', '1'),
      rejectingExecutor('off-ramp'),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok || result.error !== 'no_route_for_hop') return;
    expect(result.hopIndex).toBe(1);
    expect(result.details).toMatch(/off-ramp/);
  });
});
