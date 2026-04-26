# MCP — Agent Surface

> The Model Context Protocol server exposes Stellar Intel's router and
> oracle to AI agents. Same primitives as the web UI, one network hop away.
> An agent can price, compare, and execute an off-ramp in five lines.

Status: **wave 2.3 / v2.x** — spec stabilising, reference server shipping.

---

## Table of contents

- [Why an MCP surface](#why-an-mcp-surface)
- [Install](#install)
- [Tool list](#tool-list)
  - [`stellar_intel.price_offramp`](#stellar_intelprice_offramp)
  - [`stellar_intel.list_anchors`](#stellar_intellist_anchors)
  - [`stellar_intel.get_reputation`](#stellar_intelget_reputation)
  - [`stellar_intel.sign_intent`](#stellar_intelsign_intent)
  - [`stellar_intel.submit_intent`](#stellar_intelsubmit_intent)
  - [`stellar_intel.poll_intent`](#stellar_intelpoll_intent)
- [Example prompts](#example-prompts)
- [Agent safety notes](#agent-safety-notes)
- [Transport + auth](#transport--auth)

---

## Why an MCP surface

Two kinds of consumers matter:

- **Humans** use the web UI.
- **Agents** use tools. An agent routing a payment across corridors should
  not scrape the UI; it should call typed tools that return structured
  data.

MCP is the right layer because it is framework-agnostic — the same server
works from Claude Code, Claude Desktop, ChatGPT (via OpenAI tool calls
bridged by an MCP client), Cursor, and any bespoke runner. We ship one
server and every serious agent runtime can consume it.

Design principle: **every tool maps 1-to-1 to an Intent API endpoint.**
No agent-only magic. An agent cannot do anything a human user cannot do.

---

## Install

The server ships as an npm package, runnable over stdio (the default MCP
transport).

```bash
# Claude Code / Claude Desktop
claude mcp add stellar-intel -- npx -y @stellarintel/mcp

# Cursor: add to .cursor/mcp.json
#   {
#     "mcpServers": {
#       "stellar-intel": {
#         "command": "npx",
#         "args": ["-y", "@stellarintel/mcp"]
#       }
#     }
#   }

# Manual (debugging)
npx @stellarintel/mcp --transport stdio
npx @stellarintel/mcp --transport sse --port 4322
```

Config lives at `~/.config/stellarintel/mcp.json`:

```json
{
  "apiBase": "https://stellar-intel.vercel.app/api/v1",
  "network": "mainnet",
  "signer": { "kind": "freighter" },
  "oracleId": "CA…"
}
```

Set `signer` to `{ "kind": "readonly" }` to disable any tool that signs
or submits. Recommended default for exploratory agent sessions.

---

## Tool list

Every tool returns `{ data, error }` envelopes mirroring the REST API.
Tool descriptions below are abbreviated; the authoritative `inputSchema`
ships inside the server and is visible to the agent runtime.

### `stellar_intel.price_offramp`

Fetch ranked anchor quotes for an off-ramp intent (draft, unsigned).

```jsonc
// input
{
  "sourceAsset":  { "code": "USDC", "issuer": "GA5Z…" },
  "sourceAmount": "100.00",
  "targetAsset":  { "code": "NGN" },
  "country":      "NG"
}

// output
{
  "routes": [
    {
      "id":          "r_01H…",
      "anchorId":    "cowrie",
      "netLanded":   "141230.00",
      "fees":        "110.00",
      "rate":        "1412.30",
      "trustScore":  84.2,
      "validUntil":  "2026-04-24T14:18:00Z"
    }
  ]
}
```

### `stellar_intel.list_anchors`

Lists anchors supporting a corridor, sorted by TrustScore. Read-only,
no intent required.

### `stellar_intel.get_reputation`

Direct read from the Soroban oracle for one anchor. Returns the full
aggregate record from [`docs/ORACLE_SPEC.md`](ORACLE_SPEC.md).

### `stellar_intel.sign_intent`

Sign a quoted intent. Requires `signer.kind != "readonly"`.

- With `freighter`: pops a browser prompt (desktop environments only).
- With `sep10-session`: signs against an already-authenticated SEP-10
  session token.
- With `hw-wallet`: routes through a Ledger/Trezor bridge.

Returns the signed envelope ready for `submit_intent`. The server
**never** persists the secret key; signing happens in the user-owned
signer process.

### `stellar_intel.submit_intent`

Submits a signed envelope to the router. Returns the SEP-24 interactive
URL. Agents **must** surface this URL to the user rather than auto-opening
it — the SEP-24 step is where KYC happens.

### `stellar_intel.poll_intent`

Polls the state of an intent by `intentHash`. Returns the lifecycle state
and terminal-state metadata (tx hash, failure reason) once applicable.

---

## Example prompts

### Read-only exploration

> _"What are the three best USDC → NGN anchors right now? Break the
> decision down by net landed value and reputation."_

The agent calls `price_offramp(USDC, 100, NGN, NG)`, then
`get_reputation` for each of the top three `anchorId`s, then writes a
short comparison. No funds move.

### End-to-end execution (with signer)

> _"Send $100 USDC to my Kuda account 0123456789 (bank code 058). Pick
> the best rate. Tell me when it lands."_

The agent walks the pipeline:

1. `price_offramp`
2. Surfaces the top route and minimum landed value to the user.
3. On user confirmation, `sign_intent` (Freighter pop-up).
4. `submit_intent`.
5. Hands the SEP-24 interactive URL back to the user for KYC.
6. Polls `poll_intent` until `fulfilled`, then reports the transaction
   link.

### Reputation-aware gating

> _"Only use anchors with a TrustScore above 75 and high confidence.
> If none exist for this corridor, say so."_

Agent filters `list_anchors` output before ever invoking `price_offramp`.

---

## Agent safety notes

The MCP surface is designed so an agent **cannot** move money without
the user's key signing a specific intent. Everything below is the
enforcement of that principle.

1. **No auto-submit.** An agent cannot chain `sign_intent` →
   `submit_intent` without a user-present acknowledgement. The server
   emits a `user_attestation_required` challenge between the two calls
   whenever the agent runtime signals it is acting without direct user
   input.
2. **Deadline ceiling.** The server rejects any intent with `deadline >
now + 10min`. An agent cannot pre-sign intents to burn later.
3. **Nonce-per-session.** The server allocates nonces and returns them
   in the quote response; agents should not compose nonces themselves.
   (This is a belt-and-braces to prevent replay across sessions.)
4. **Readonly by default.** Fresh `stellarintel/mcp` installs default
   to `signer.kind = "readonly"`. The user must explicitly turn on
   signing.
5. **Logged by default.** Every signed intent hash is logged in
   `~/.local/share/stellarintel/agent-log.ndjson` so the user has an
   audit trail of what their agent authorised.
6. **KYC happens at the anchor, not the agent.** We do not mediate KYC.
   The SEP-24 interactive URL is the user's contract with the anchor;
   the agent must surface it.

An AI-agent threat model extends the core one in
[`docs/THREAT_MODEL.md`](THREAT_MODEL.md) with an explicit _agent-acting-
without-user-context_ scenario and its mitigations.

---

## Transport + auth

- **Transport**: stdio by default; SSE and HTTP/2 streaming are supported
  for containerised deployments.
- **Server auth**: read tools are unauthenticated; write tools require a
  bearer token emitted by the user's signing bridge.
- **Rate limits**: 60 rpm per client id for read tools, 10 rpm for
  sign/submit. Agents that misbehave get throttled, not banned — the
  default posture is _permissive-but-accounted_.

The reference server lives at
[`packages/mcp/`](../packages/mcp/) (ships wave 2.3). Until then, the
canonical behaviour lives in this document.
