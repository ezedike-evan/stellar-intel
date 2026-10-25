import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { depositLimitStatus } from '@/lib/stellar/deposit-limits';
import * as depositRates from '@/lib/stellar/deposit-rates';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

// next build failed once because a client component imported a helper from
// lib/stellar/deposit-rates.ts, which reaches the reputation store and so `pg`.
describe('deposit limits stay client-safe', () => {
  it('lib/stellar/deposit-limits.ts has no runtime imports', () => {
    const runtimeImports = read('lib/stellar/deposit-limits.ts')
      .split('\n')
      .filter((line) => /^import\s/.test(line) && !/^import\s+type\s/.test(line));
    expect(runtimeImports).toEqual([]);
  });

  it('DepositRateTable does not import the server-side rates module', () => {
    expect(read('components/onramp/DepositRateTable.tsx')).not.toMatch(
      /from\s+'@\/lib\/stellar\/deposit-rates'/
    );
  });

  it('deposit-rates still exports the same helper for server callers', () => {
    expect(depositRates.depositLimitStatus).toBe(depositLimitStatus);
  });
});
