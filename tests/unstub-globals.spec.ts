import { describe, it, expect, vi } from 'vitest';

describe('unstubGlobals option in unit test project', () => {
  it('stubs global probe property on globalThis', () => {
    vi.stubGlobal('__probe', 'test-probe-value');
    expect((globalThis as Record<string, unknown>).__probe).toBe('test-probe-value');
    expect('__probe' in globalThis).toBe(true);
  });

  it('automatically unsets global probe property before subsequent test', () => {
    expect('__probe' in globalThis).toBe(false);
  });
});
