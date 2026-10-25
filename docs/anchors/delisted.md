# Delisted anchors

**Last reviewed:** 2026-10-25

Anchors removed from [`constants/anchors.ts`](../../constants/anchors.ts) because
they stopped serving the rails they were registered for. Each entry records why,
the evidence, what it was registered as, and what has to be true before it goes
back, so the follow-up can be done without rediscovering any of it.

This is different from [`exclusions.md`](./exclusions.md), which lists domains
that never had transfer rails. Everything here once did.

A delisting removes the registry entry and, where the anchor was the only one on
a corridor, moves the corridor into `V11_CORRIDOR_IDS` so it stays resolvable
for lookups but is hidden from selectors. `constants/anchor-health.json` keeps
the old ledger row until the nightly job rewrites it.

## How to re-list

1. Confirm the condition in the entry's **Re-list when** line from a normal
   network, not only from CI: the nightly runner is a datacenter IP and some
   anchors put a WAF in front of `/info`.
2. Restore the registry entry from the **Was** line, and remove the corridor
   from `V11_CORRIDOR_IDS` if the anchor is its only server.
3. Restore the spec in `tests/anchors.<id>.spec.ts` to its positive form, the
   onramp fixture in `tests/fixtures/onramp/`, the SEP-38 capture entry in
   `tests/fixtures/sep38/capability-capture.json`, and the `ALLOWLIST` entry in
   `scripts/check-registry.mjs`.
4. Run `npm run emit-llms-full`: the registry count appears in generated copy.

## Open follow-ups

| Anchor     | Delisted   | Corridor | Follow up                                               |
| ---------- | ---------- | -------- | ------------------------------------------------------- |
| Bitnovo    | 2026-10-25 | usdc-eur | Check whether `stellar.bitnovo.com` serves 200 again    |
| FinClusive | 2026-10-25 | usdc-usd | Check whether the `api.finclusive.com` cert was renewed |
| MyKobo     | 2026-09-06 | usdc-eur | Check whether a transfer server that resolves is listed |

Contacting the operator is the only way any of these come back. None is fixable
from our side.

## Bitnovo (`bitnovo`, `stellar.bitnovo.com`)

- **Delisted:** 2026-10-25
- **Why:** the whole host answers HTTP 502 from its proxy, `/.well-known/stellar.toml`
  and the SEP-24 `/info` included. The nightly probe recorded the 502 on every
  run for 13 nights, and the health ledger carried `degraded: true` with
  `consecutiveFailures: 12` before the delisting. SEP-24 cannot be reached.
- **Evidence:** `curl -i https://stellar.bitnovo.com/` returns 502. The IP
  resolves (`178.62.246.29` on 2026-10-25), so the proxy is up and the backend
  behind it is not. Tracked by the nightly integrity and data-health alert
  issues #1934–#2023, closed with the delisting.
- **Was registered as:** USDC (canonical issuer), corridor `usdc-eur` flagged
  unverified, SEPs 10 and 24, SEP-24 at `https://stellar.bitnovo.com/sep24`.
  `/info` listed deposit and withdraw pairs for EUR, native and USDC with fees
  disabled. The EUR rail asset was never a declared TOML asset.
- **Corridor impact:** none. `usdc-eur` is still served by APS Ramp.
- **Re-list when:** the TOML and `https://stellar.bitnovo.com/sep24/info` both
  answer 200. The corridor was never end-to-end verified, so it comes back
  flagged unverified.

## FinClusive (`finclusive`, `finclusive.com`)

- **Delisted:** 2026-10-25
- **Why:** the TLS certificate on `api.finclusive.com` expired on 2026-10-04.
  That host serves the SEP-6 and SEP-24 transfer server and SEP-10 auth, so any
  client that verifies certificates fails before reaching `/info`. The
  `finclusive.com` TOML is on a different host and still answers 200, which is
  why the hourly ledger, which stops at the TOML, kept reporting the anchor
  healthy. The nightly probe follows the advertised endpoint and failed on it
  every night.
- **Evidence:** `openssl s_client -connect api.finclusive.com:443` reports
  `notAfter=Oct  4 21:47:57 2026 GMT`; `curl` fails with "SSL certificate
  problem: certificate has expired".
- **Was registered as:** USDC (canonical issuer), corridor `usdc-usd` flagged
  unverified (`/info` showed no withdraw types, so the fiat leg was only
  evidenced by the SDF directory), SEPs 6, 10, 24 and 31, transfer server
  `https://api.finclusive.com/stellar/transfer`. Confidence was low.
- **Corridor impact:** `usdc-usd` had no other anchor, so it is now in
  `V11_CORRIDOR_IDS`: resolvable for lookups, hidden from selectors.
- **Re-list when:** `api.finclusive.com` presents a valid certificate and
  `/stellar/transfer/info` answers 200.
- **Open gap:** the hourly ledger probe only reads the TOML, so an expired
  certificate on the transfer server never reaches it. Same blind spot as
  MyKobo. Not fixed here.

## MyKobo (`mykobo`, `mykobo.co`)

- **Delisted:** 2026-09-06
- **Why:** its `stellar.toml` advertises `TRANSFER_SERVER` and
  `TRANSFER_SERVER_SEP0024` on `stellar.mykobo.co`, which has no A or AAAA
  record. Every SEP-6 and SEP-24 call fails to connect, while the TOML itself
  still answers 200.
- **Was registered as:** EURC (issuer
  `GAQRF3UGHBT6JYQZ7YSUYCIYWAF4T2SAA5237Q5LIQYJOHHFAWDXZ7NM`), corridor
  `usdc-eur`, SEPs 6, 24 and 31.
- **Corridor impact:** `usdc-eur` was orphaned until APS Ramp and Bitnovo took
  it over; it is served by APS Ramp now.
- **Re-list when:** MyKobo publishes a transfer server that resolves.
- **Record:** commit `c97c37ce`, and the entry in
  [`SEP_COMPLIANCE.md`](../SEP_COMPLIANCE.md).
