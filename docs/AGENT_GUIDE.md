# Agent Guide

> Five lines is all it takes to get an AI agent to off-ramp. Install the
> MCP server, expose the signer, let the agent call the same tools the
> web UI does.
>
> This guide targets Anthropic Claude (Code / Desktop) and OpenAI
> function-calling via an MCP-to-OpenAI bridge. The MCP server is the
> canonical surface; framework shims on top of it should not leak
> differences.

---

## Table of contents

- [Five-line Claude example](#five-line-claude-example)
- [Five-line OpenAI example](#five-line-openai-example)
- [What the agent can and cannot do](#what-the-agent-can-and-cannot-do)
- [Signer modes](#signer-modes)
- [Prompting patterns that work](#prompting-patterns-that-work)
- [Debugging an agent run](#debugging-an-agent-run)

---

## Five-line Claude example

```bash
# 1. Install the MCP server.
claude mcp add stellar-intel -- npx -y @stellarintel/mcp

# 2. Confirm install.
claude mcp list | grep stellar-intel

# 3. Ask the agent for a quote.
claude 'Using the stellar-intel tools, quote me 100 USDC to NGN via a bank account. Show TrustScores too.'

# 4. Ask the agent to execute (signer=freighter required).
claude 'Send 100 USDC to NGN account 0123456789, bank 058. Use stellar-intel. Ask me to confirm before signing.'

# 5. Ask it to wait.
claude 'Poll the intent every 20 seconds until terminal state and summarise the outcome.'
```

Lines 1 + 2 are install. Lines 3 + 4 + 5 are the agent doing the work.

---

## Five-line OpenAI example

OpenAI function-calling does not natively speak MCP. Run an MCP-to-OpenAI
bridge (`@stellarintel/openai-bridge`) to expose the tools:

```ts
import OpenAI from 'openai';
import { tools, handler } from '@stellarintel/openai-bridge';

const ai = new OpenAI();

async function run(prompt: string) {
  const msg = [{ role: 'user', content: prompt } as const];
  for (;;) {
    const res = await ai.chat.completions.create({
      model: 'gpt-5-1', // or any tool-capable model
      messages: msg,
      tools,
    });
    const call = res.choices[0].message.tool_calls?.[0];
    if (!call) {
      return res.choices[0].message.content;
    }
    const out = await handler(call.function.name, JSON.parse(call.function.arguments));
    msg.push(res.choices[0].message, {
      role: 'tool',
      tool_call_id: call.id,
      content: JSON.stringify(out),
    });
  }
}

run('Quote 100 USDC → NGN on the best-TrustScore anchor.').then(console.log);
```

Same tools. Same safety rails. The bridge does not add OpenAI-specific
behaviour beyond function-calling protocol translation.

---

## What the agent can and cannot do

**Can.**

- Call any read tool (list anchors, price, reputation, poll).
- Initiate a sign — the signature still needs the user's wallet to
  produce bytes.
- Initiate a submit after signing — again only if the signer was
  authorised.
- Explain a route's TrustScore and confidence in natural language.
- Choose among routes by any criterion the user expresses.

**Cannot.**

- Bypass the signer. A missing signer throws `signer.unavailable`; the
  tool does not silently skip the signature.
- Exceed the 10-minute deadline ceiling. The server rejects any
  submission past its deadline.
- Reuse a nonce. The server rejects duplicates; an agent cannot replay.
- Auto-sign. With `user_attestation_required` in effect, the agent
  must surface the intent to the user before the sign tool succeeds.
- See user KYC data. SEP-24 interactive URL is the user's link to the
  anchor; the agent never sees the contents.

These constraints are enforced server-side. Framework prompts and
agent instructions are belt-and-braces, not the primary rail.

---

## Signer modes

Configured in `~/.config/stellarintel/mcp.json` → `signer.kind`:

- `readonly` (default). Sign / submit tools throw. Safe for exploratory
  sessions with a new agent.
- `freighter`. Signing requests open a browser popup; only viable when
  the agent is running on a desktop OS with a graphical session.
- `sep10-session`. Pre-authenticated SEP-10 session token. Useful for
  headless server-side agents _where the user has already authenticated
  out-of-band_. The token expires in 24h and the agent cannot refresh it.
- `hw-wallet`. Bridges to Ledger / Trezor via the Stellar Intel
  hardware adapter. Same UX as Freighter but with physical confirmation.

An agent should never hardcode `freighter` or `sep10-session` — let the
user configure the signer, and have the agent fall back to `readonly`
gracefully if the configured signer is unreachable.

---

## Prompting patterns that work

Three patterns that reliably produce good runs:

### 1. State the constraint, not the route

**Bad.** _"Send 100 USDC to NGN via Cowrie."_ — picks the anchor for
the agent, bypassing the whole point of the router.

**Good.** _"Send 100 USDC to NGN, minimum ₦140 500 landed, only
anchors with TrustScore ≥ 75."_ — lets the agent use `list_anchors` +
`price_offramp` to decide; the constraint is checkable.

### 2. Ask for an explicit confirmation step

**Good.** _"Review the route you picked with me, then sign only after
I confirm."_ — produces a natural pause in the tool chain where the
user can veto.

### 3. Bound the poll

**Good.** _"Poll the intent every 20 seconds for up to 10 minutes, then
stop and tell me the state even if it's not terminal."_ — avoids runaway
polling.

---

## Debugging an agent run

1. `tail -f ~/.local/share/stellarintel/agent-log.ndjson` — every
   signed intent hash and its lifecycle state.
2. `stellar-intel diagnose <intentHash>` (CLI ships with the SDK) —
   dumps the router trace, anchor response, and oracle observation.
3. MCP stdio debug: re-launch `npx @stellarintel/mcp --log-level debug`
   in a terminal; pipe the agent's tool calls through and inspect the
   request/response bodies.
4. For a silent failure: check signer health first.
   - `signer.kind == freighter` and no popup? Freighter extension
     disabled or on the wrong network.
   - `signer.kind == sep10-session` and token-invalid? Session expired;
     re-authenticate.

Every tool response carries a `meta.requestId`; grep the server logs
with it to get the full trace. If you cannot reproduce, open an issue
with the `requestId` and we will look it up.
