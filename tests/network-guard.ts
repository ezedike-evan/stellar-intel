/**
 * A guard that turns an unmocked network call in a unit test into an immediate,
 * named failure (#1411).
 *
 * The unit project promises that nothing in it makes a real network call, but
 * nothing enforced that: a new spec that forgot to mock `fetch` would quietly
 * call real anchors from CI and from a developer's machine. This is installed
 * from tests/setup.ts, so it applies to every unit spec.
 *
 * It wraps `globalThis.fetch` and `request`/`get` on `node:http` and
 * `node:https`. `vi.stubGlobal('fetch', ...)` replaces the guard for that test,
 * and msw's `setupServer()` wraps it and answers handled requests itself, so
 * both keep working; only a request that reaches the guard is refused.
 *
 * Allowed: localhost, 127.0.0.1, [::1], `data:` and `blob:` URLs, and any host in
 * the comma-separated `TEST_NETWORK_ALLOW`. A relative URL is refused: in a unit
 * test there is no server for it to reach. The whole guard is a no-op when
 * `TEST_ALLOW_NETWORK=1`, which only the live-anchors project sets.
 */

import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { expect } from 'vitest';

const INSTALLED = Symbol.for('stellar-intel.network-guard');
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
/** A base for resolving relative URLs, so they are recognisable and refused. */
const NO_HOST_BASE = 'http://relative-url.invalid';

function allowedHosts(): Set<string> {
  const extra = (process.env['TEST_NETWORK_ALLOW'] ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...LOOPBACK, ...extra]);
}

function currentTest(): string {
  return expect.getState().currentTestName ?? 'an unknown test';
}

function isAllowedHost(hostname: string): boolean {
  return allowedHosts().has(hostname.toLowerCase());
}

function isAllowed(url: URL): boolean {
  if (url.protocol === 'data:' || url.protocol === 'blob:') return true;
  return isAllowedHost(url.hostname);
}

function refuse(target: string): never {
  throw new Error(`[network-guard] unmocked request to ${target} in ${currentTest()}`);
}

function describeFetchInput(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof input === 'object' && input !== null && 'url' in input) {
    return String((input as { url: unknown }).url);
  }
  return String(input);
}

function guardFetch(real: typeof globalThis.fetch): typeof globalThis.fetch {
  return function guardedFetch(input, init) {
    const target = describeFetchInput(input);
    let url: URL;
    try {
      url = new URL(target, NO_HOST_BASE);
    } catch {
      return Promise.reject(new Error(`[network-guard] unparseable request URL ${target}`));
    }
    if (!isAllowed(url)) {
      return Promise.reject(
        new Error(`[network-guard] unmocked request to ${target} in ${currentTest()}`)
      );
    }
    return real(input, init);
  };
}

/** The hostname in a `host` option, which may carry a port: `[::1]:80`, `localhost:3000`. */
function hostnameOf(host: string): string {
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.split(':')[0] ?? host;
}

/** What a `request`/`get` call is aimed at: a URL, a string, or an options object. */
function describeNodeTarget(first: unknown): { hostname: string; label: string } {
  if (typeof first === 'string' || first instanceof URL) {
    const url = new URL(first, NO_HOST_BASE);
    return { hostname: url.hostname, label: String(first) };
  }
  const options = (first ?? {}) as { hostname?: string; host?: string };
  const host = options.hostname ?? options.host ?? 'localhost';
  return { hostname: hostnameOf(host), label: host };
}

function guardNodeRequest<T extends (...args: never[]) => unknown>(real: T): T {
  const guarded = function (this: unknown, ...args: unknown[]) {
    let target: { hostname: string; label: string };
    try {
      target = describeNodeTarget(args[0]);
    } catch {
      return refuse(String(args[0]));
    }
    if (!isAllowedHost(target.hostname)) return refuse(target.label);
    return (real as unknown as (...a: unknown[]) => unknown).apply(this, args);
  };
  return guarded as unknown as T;
}

/**
 * Installs the guard. Safe to call more than once in a process (forked workers
 * are reused across files); only the first call wraps anything.
 */
export function installNetworkGuard(): void {
  if (process.env['TEST_ALLOW_NETWORK'] === '1') return;

  const marked = globalThis as unknown as Record<symbol, boolean>;
  if (marked[INSTALLED]) return;
  marked[INSTALLED] = true;

  if (typeof globalThis.fetch === 'function') {
    globalThis.fetch = guardFetch(globalThis.fetch);
  }

  http.request = guardNodeRequest(http.request);
  http.get = guardNodeRequest(http.get);
  https.request = guardNodeRequest(https.request);
  https.get = guardNodeRequest(https.get);

  // ESM importers (`import http from 'node:http'`) read the builtin's exports
  // through a snapshot; re-sync it so they see the wrapped functions.
  syncBuiltinESMExports();
}
