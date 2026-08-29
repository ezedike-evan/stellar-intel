import { describe, it, expect, vi, beforeEach } from 'vitest';

const POOL_ID = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
const USDC_CONTRACT = 'CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ';

const mockSubmit = vi.fn((_arg: unknown) => 'AAAAAgAAAAA=');
const mockLoad = vi.fn();

vi.mock('@blend-capital/blend-sdk', () => ({
  PoolV2: { load: mockLoad },
  PoolContractV2: class {
    submit(arg: unknown) {
      return mockSubmit(arg);
    }
  },
  RequestType: { SupplyCollateral: 2 },
}));

import { createBlendYieldHop } from '@/lib/router/connectors/yield-blend';
import type { HopAsset, HopStep } from '@/types';

const NETWORK = {
  rpc: 'https://soroban-rpc.example',
  passphrase: 'Test SDF Network ; September 2015',
};
const USDC_INPUT: HopAsset = { asset: USDC_CONTRACT, amount: '100.5000000' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createBlendYieldHop', () => {
  it('plans a supply by reading the reserve and reporting the same asset/amount', async () => {
    mockLoad.mockResolvedValue({
      reserves: new Map([[USDC_CONTRACT, { estSupplyApy: 0.045, config: { decimals: 7 } }]]),
    });

    const hop = createBlendYieldHop({ poolId: POOL_ID, network: NETWORK, account: 'GABC' });
    const result = await hop.plan(USDC_INPUT, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.step.hopType).toBe('yield');
    expect(result.step.output).toEqual(USDC_INPUT); // supply doesn't convert the asset
    expect(result.step.details['estSupplyApy']).toBe(0.045);
    expect(result.step.details['decimals']).toBe(7);
    expect(mockLoad).toHaveBeenCalledWith(NETWORK, POOL_ID);
  });

  it('rejects an input asset that is not a Soroban contract address', async () => {
    const hop = createBlendYieldHop({ poolId: POOL_ID, network: NETWORK, account: 'GABC' });
    const result = await hop.plan({ asset: 'iso4217:NGN', amount: '100' }, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unsupported_asset');
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('fails planning when the pool has no reserve for the input asset', async () => {
    mockLoad.mockResolvedValue({ reserves: new Map() });

    const hop = createBlendYieldHop({ poolId: POOL_ID, network: NETWORK, account: 'GABC' });
    const result = await hop.plan(USDC_INPUT, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('reserve_not_found');
  });

  it('fails planning when the pool fails to load', async () => {
    mockLoad.mockRejectedValue(new Error('RPC timeout'));

    const hop = createBlendYieldHop({ poolId: POOL_ID, network: NETWORK, account: 'GABC' });
    const result = await hop.plan(USDC_INPUT, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('pool_load_failed');
  });

  it('executes by building the unsigned supply operation with the correct base-unit amount', async () => {
    const hop = createBlendYieldHop({ poolId: POOL_ID, network: NETWORK, account: 'GABC' });
    const step: HopStep = {
      hopType: 'yield',
      hopId: `blend-yield-${POOL_ID}`,
      input: USDC_INPUT,
      output: USDC_INPUT,
      details: { poolId: POOL_ID, estSupplyApy: 0.045, decimals: 7 },
    };

    const result = await hop.execute(step, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.details).toEqual({ unsignedXdr: 'AAAAAgAAAAA=' });
    // 100.5000000 at 7 decimals -> 1005000000n base units
    expect(mockSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'GABC',
        requests: [expect.objectContaining({ amount: 1005000000n, request_type: 2 })],
      })
    );
  });

  it('fails execution when the step was not planned by this connector', async () => {
    const hop = createBlendYieldHop({ poolId: POOL_ID, network: NETWORK, account: 'GABC' });
    const step: HopStep = {
      hopType: 'yield',
      hopId: `blend-yield-${POOL_ID}`,
      input: USDC_INPUT,
      output: USDC_INPUT,
      details: {}, // no decimals
    };

    const result = await hop.execute(step, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('missing_planned_decimals');
  });
});
