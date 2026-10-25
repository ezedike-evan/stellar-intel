import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

// `next build` failed because lib/stellar/sep1.ts imported lib/logger.ts (pino and
// node:async_hooks). sep1 is reached from client components through sep24, so
// anything it imports ends up in the browser bundle. vitest cannot see that: it
// runs in node, where the import works.
describe('modules reachable from client components stay browser-safe', () => {
  it.each(['lib/stellar/sep1.ts', 'lib/stellar/sep24.ts'])(
    '%s does not import the node-only logger',
    (file) => {
      expect(read(file)).not.toMatch(/from\s+'@\/lib\/logger'/);
    }
  );

  it('lib/logger.ts is the node-only one this guards against', () => {
    expect(read('lib/logger.ts')).toMatch(/async_hooks/);
  });
});
