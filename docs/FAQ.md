# FAQ

### Is this custodial? Do you hold my money?

No. Stellar Intel never holds user funds, user keys, fiat, or KYC data. You sign
every transaction in your own wallet; the anchor takes custody under SEP-24/SEP-6;
Stellar enforces atomicity. See [`docs/NON_CUSTODY.md`](NON_CUSTODY.md).

### What happens if an anchor fails or doesn't pay out?

The anchor — not Stellar Intel — is the settlement party. We surface that risk
**before** you choose: each anchor carries a reputation score built from real
outcomes (fill rate, slippage, settle latency). A failing anchor ranks down and
its failures are recorded. If an outcome is wrong, you can file a dispute, which
resolves on signed, replayable evidence. See
[`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md).

### How is this different from a block explorer or a single anchor's app?

We compare **live rates across every integrated anchor** and rank by net landed
value (rate − fees − slippage − historical fill-rate penalty), not headline rate —
then let you execute in one click. Plus a public reputation oracle and an MCP agent
surface. It's the execution layer, not just a price page.

### Why did anchor X not show up in the comparison?

Most often: the anchor doesn't serve that corridor, or it only exposes a SEP the
rate engine doesn't yet quote. Historically SEP-6-only anchors (e.g. Cowrie) were
dropped because the flow was SEP-24-only — SEP-6 support is being added (see
[`docs/SEP_COMPLIANCE.md`](SEP_COMPLIANCE.md)). Failed anchors render as
"unavailable" rather than disappearing silently.

### Which corridors and anchors are supported?

See the registry in [`constants/anchors.ts`](../constants/anchors.ts) and the live
app. Coverage expands via [anchor onboarding](ANCHOR_ONBOARDING.md).

### Can an AI agent off-ramp through this?

Yes — an MCP server exposes pricing/comparison and a user-signed execute path. The
agent cannot move funds on its own; every executing call must be signed by the
user's wallet. See [`docs/MCP.md`](MCP.md).

### Is there an SDK?

A typed client (`@stellarintel/sdk`) is on the roadmap (v4). Today you can call the
[HTTP API](INTENT_API.md) directly. See [`docs/SDK.md`](SDK.md).

### How do I contribute?

Read [`CONTRIBUTING.md`](../CONTRIBUTING.md), pick a
[`good-first-issue`](https://github.com/Ezedike-Evan/stellar-intel/labels/good-first-issue),
and open a PR. The [`docs/COOKBOOK.md`](COOKBOOK.md) has end-to-end recipes.
