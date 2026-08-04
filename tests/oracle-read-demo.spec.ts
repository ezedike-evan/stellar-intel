import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

// #723 — "verify the testnet oracle read displays correctly in the demo".
//
// Deliberately a test rather than a manual check. A verification issue with no
// falsifiable completion condition stays open forever, and "I looked at it and
// it looked right" does not survive a redeploy.
//
// The live testnet contract is NOT contacted here: a third-party network must
// never be able to red the main branch. The live check runs warn-only in
// nightly.yml. What is asserted here is everything that can go wrong without
// the network: which contract we point at, and whether the value reaches the
// surface that displays it.

describe('oracle deployment address (#723)', () => {
  it('reads the contract id from the recorded deployment', async () => {
    const { TESTNET_ORACLE_CONTRACT_ID } = await import('@/lib/oracle/deployment');
    const recorded = JSON.parse(readFileSync('.deployments/testnet.json', 'utf8')) as {
      contractId: string;
    };
    expect(TESTNET_ORACLE_CONTRACT_ID).toBe(recorded.contractId);
  });

  it('is not hardcoded anywhere else', async () => {
    // The address used to be duplicated in lib/oracle/read.ts and the publisher
    // tick route. Three copies of something that changes on every redeploy
    // means reads and writes can silently target different contracts — no
    // error, just wrong numbers.
    const { TESTNET_ORACLE_CONTRACT_ID } = await import('@/lib/oracle/deployment');
    const sources = [
      'lib/oracle/read.ts',
      'app/api/publisher/tick/route.ts',
      'app/api/reputation/leaderboard/route.ts',
    ];
    for (const file of sources) {
      expect(readFileSync(file, 'utf8')).not.toContain(TESTNET_ORACLE_CONTRACT_ID);
    }
  });

  it('lets an explicit id and env var override the recorded one', async () => {
    const { resolveOracleContractId, TESTNET_ORACLE_CONTRACT_ID } =
      await import('@/lib/oracle/deployment');
    expect(resolveOracleContractId('CEXPLICIT')).toBe('CEXPLICIT');

    const previous = process.env.ORACLE_CONTRACT_ID;
    process.env.ORACLE_CONTRACT_ID = 'CFROMENV';
    try {
      // A redeploy that has not been committed yet still needs a way in.
      expect(resolveOracleContractId()).toBe('CFROMENV');
      expect(resolveOracleContractId('CEXPLICIT')).toBe('CEXPLICIT');
    } finally {
      if (previous === undefined) delete process.env.ORACLE_CONTRACT_ID;
      else process.env.ORACLE_CONTRACT_ID = previous;
    }

    expect(resolveOracleContractId()).toBe(TESTNET_ORACLE_CONTRACT_ID);
  });
});

describe('the demo surface renders the on-chain read (#723)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('puts get_score_for_corridor output in the leaderboard payload', async () => {
    vi.doMock('@/lib/oracle/read', () => ({
      getScoreForCorridor: vi.fn().mockResolvedValue({
        compositeBps: 8500,
        fillRateBps: 9700,
        slippageBps: 110,
        settleSecondsP50: 42,
        n: 1240,
      }),
    }));
    vi.doMock('@/lib/reputation/store', () => ({
      tryGetReputationStore: () => null,
    }));

    const { GET } = await import('@/app/api/reputation/leaderboard/route');
    const { NextRequest } = await import('next/server');

    const corridor = (await import('@/constants')).CORRIDORS[0]!.id;
    const res = await GET(
      new NextRequest(`https://example.test/api/reputation/leaderboard?corridor=${corridor}`)
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      leaderboard: Array<{ anchor_id: string; onChain: { compositeBps: number } | null }>;
    };

    const withOnChain = body.leaderboard.filter((e) => e.onChain !== null);
    // This is the assertion #723 actually wanted: the value read from the
    // contract reaches the response the demo renders, rather than being fetched
    // and dropped.
    expect(withOnChain.length).toBeGreaterThan(0);
    expect(withOnChain[0]?.onChain?.compositeBps).toBe(8500);
  });

  it('degrades to null rather than failing when the read throws', async () => {
    vi.doMock('@/lib/oracle/read', () => ({
      getScoreForCorridor: vi.fn().mockRejectedValue(new Error('rpc unreachable')),
    }));
    vi.doMock('@/lib/reputation/store', () => ({
      tryGetReputationStore: () => null,
    }));

    const { GET } = await import('@/app/api/reputation/leaderboard/route');
    const { NextRequest } = await import('next/server');

    const corridor = (await import('@/constants')).CORRIDORS[0]!.id;
    const res = await GET(
      new NextRequest(`https://example.test/api/reputation/leaderboard?corridor=${corridor}`)
    );

    // Testnet RPC being down must degrade the demo, not break it.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { leaderboard: Array<{ onChain: unknown }> };
    expect(body.leaderboard.every((e) => e.onChain === null)).toBe(true);
  });
});

describe('an unregistered anchor is absent, not zero (#723)', () => {
  beforeEach(() => {
    // resetModules() does not clear doMock registrations, so the leaderboard
    // block above would otherwise keep lib/oracle/read mocked out from under
    // these tests — which need the real implementation.
    vi.doUnmock('@/lib/oracle/read');
    vi.doUnmock('@/lib/reputation/store');
    vi.resetModules();
  });

  it('returns null when the contract reports no samples', async () => {
    vi.doMock('@stellar/stellar-sdk', async () => {
      const actual =
        await vi.importActual<typeof import('@stellar/stellar-sdk')>('@stellar/stellar-sdk');
      return {
        ...actual,
        rpc: {
          ...actual.rpc,
          Server: class {
            async simulateTransaction() {
              // What the deployed testnet contract actually returns today for an
              // (anchor, corridor) it has never seen: a zeroed tuple.
              return { result: { retval: 'ZEROES' } };
            }
          },
          Api: { isSimulationError: () => false },
        },
        scValToNative: () => [0n, 0n, 0n, 0],
      };
    });

    const { getScoreForCorridor } = await import('@/lib/oracle/read');
    // Reported as absent so the demo can render "—" rather than a confident 0.
    expect(await getScoreForCorridor('never-registered', 'usdc-ngn')).toBeNull();
  });

  it('returns the score when the contract reports samples', async () => {
    vi.doMock('@stellar/stellar-sdk', async () => {
      const actual =
        await vi.importActual<typeof import('@stellar/stellar-sdk')>('@stellar/stellar-sdk');
      return {
        ...actual,
        rpc: {
          ...actual.rpc,
          Server: class {
            async simulateTransaction() {
              return { result: { retval: 'SCORED' } };
            }
          },
          Api: { isSimulationError: () => false },
        },
        scValToNative: () => [8500n, 9700n, 42n, 1240],
      };
    });

    const { getScoreForCorridor } = await import('@/lib/oracle/read');
    const score = await getScoreForCorridor('bitso', 'usdc-ngn');
    expect(score).toEqual({
      compositeBps: 8500,
      fillRateBps: 9700,
      settleSecondsP50: 42,
      n: 1240,
    });
  });
});

describe('governance readback (#913)', () => {
  it('classifies a missing entrypoint apart from a genuine read failure', async () => {
    const { isMissingEntrypointError } = await import('@/lib/oracle/read');

    // What the host actually returned for the deployed testnet contract.
    expect(
      isMissingEntrypointError(
        'Oracle read "pending_admin" simulation failed: HostError: Error(WasmVm, MissingValue)'
      )
    ).toBe(true);
    expect(isMissingEntrypointError('trying to invoke non-existent contract function')).toBe(true);

    // A network problem is not an absent entrypoint, and must not be silently
    // recorded as one.
    expect(isMissingEntrypointError('fetch failed: ECONNREFUSED')).toBe(false);
  });

  it('flags a deployment older than the source', async () => {
    const { deriveGovernance } = await import('@/lib/oracle/read');

    // Exactly the deployed testnet contract's shape: it predates the two-step
    // admin handoff, and therefore predates the auth fixes in #907.
    const gov = deriveGovernance(
      { admin: 'GADMIN', pendingAdmin: undefined, upgradeAdmin: undefined, contractVersion: 0 },
      ['pending_admin', 'upgrade_admin']
    );

    expect(gov.admin).toBe('GADMIN');
    expect(gov.upgradeAdmin).toBeNull();
    expect(gov.contractVersion).toBe(0);
    expect(gov.missingEntrypoints).toEqual(['pending_admin', 'upgrade_admin']);
    expect(gov.authoritiesSeparated).toBe(false);
  });

  it('reports separated authorities when they are distinct accounts', async () => {
    const { deriveGovernance } = await import('@/lib/oracle/read');
    const gov = deriveGovernance(
      { admin: 'GADMIN', pendingAdmin: null, upgradeAdmin: 'GUPGRADE', contractVersion: 3 },
      []
    );

    expect(gov.authoritiesSeparated).toBe(true);
    expect(gov.contractVersion).toBe(3);
  });

  it('does not call one account holding both roles "separated"', async () => {
    const { deriveGovernance } = await import('@/lib/oracle/read');
    const gov = deriveGovernance(
      { admin: 'GSAME', pendingAdmin: null, upgradeAdmin: 'GSAME', contractVersion: 3 },
      []
    );

    // One compromised key could both forge data and replace the code.
    expect(gov.authoritiesSeparated).toBe(false);
  });

  it('treats an unset upgrade admin as not separated', async () => {
    const { deriveGovernance } = await import('@/lib/oracle/read');
    const gov = deriveGovernance(
      { admin: 'GADMIN', pendingAdmin: null, upgradeAdmin: null, contractVersion: 0 },
      []
    );

    // An uninitialised upgrade hook is an absence of separation, not a
    // separation — this is the deployed testnet contract's current state.
    expect(gov.authoritiesSeparated).toBe(false);
  });
});
