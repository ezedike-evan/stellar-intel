# Stellar Intel

[![License: MIT](https://img.shields.io/github/license/Ezedike-Evan/stellar-intel?style=flat-square)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/Ezedike-Evan/stellar-intel/ci.yml?branch=main&style=flat-square&label=ci)](https://github.com/Ezedike-Evan/stellar-intel/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/codecov/c/github/Ezedike-Evan/stellar-intel?style=flat-square)](https://codecov.io/gh/Ezedike-Evan/stellar-intel)
[![npm (@stellarintel/sdk)](https://img.shields.io/npm/v/@stellarintel/sdk?style=flat-square&label=%40stellarintel%2Fsdk)](https://www.npmjs.com/package/@stellarintel/sdk)
[![Deployed on Vercel](https://img.shields.io/badge/deploy-vercel-000?style=flat-square&logo=vercel)](https://stellar-intel.vercel.app)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-fe5196?style=flat-square&logo=conventionalcommits)](https://www.conventionalcommits.org)

**Find the best rates on Stellar, in real time.**

Stellar Intel is a rate aggregator for the Stellar ecosystem. It compares
off-ramp withdrawal rates, on-ramp deposit fees, yield protocol APYs, and
swap routes across anchors and DeFi protocols — and lets you execute directly
from the same interface.

Built for users sending money home across Africa, Latin America, and Southeast
Asia via Stellar anchors.

<p align="center">
  <a href="https://stellar-intel.vercel.app">
    <img src="docs/images/hero.png" alt="Stellar Intel off-ramp comparison — live anchor quotes, fee breakdown, and one-click execution" width="860" />
  </a>
  <br />
  <em>Live demo → <a href="https://stellar-intel.vercel.app">stellar-intel.vercel.app</a></em>
</p>

---

## Table of contents

- [Why this exists](#why-this-exists)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Contributors](#contributors)
- [License](#license)

---

## Why this exists

Moving a dollar from a wallet in San Francisco to a bank account in Lagos, Buenos
Aires, or Manila is still a small act of faith. Rates drift between the quote
and the signature, anchors fail silently, and the user finds out forty minutes
later when nothing lands. Every serious stablecoin corridor has the same three
unsolved problems: **which anchor is actually cheapest right now**, **will it
honour the quote**, and **is it up**.

Stellar Intel is the **execution layer for stablecoin value on Stellar**. We
treat an off-ramp as a signed **intent** — _"withdraw $100 USDC to this NGN
account, at or better than this rate, before this deadline"_ — and route it to
the anchor that can satisfy it. Three primitives, one product:

1. **Intent router.** Live SEP-38 quotes across every integrated anchor,
   ranked by net landed value (gross rate − fees − slippage − historical
   fill-rate penalty), not headline rate.
2. **Reputation oracle.** Every quote, fill, failure, and settlement latency
   is written to an on-chain Soroban contract. Anchors earn a public,
   user-verifiable track record; consumers read it without our permission.
3. **Agent surface.** An MCP server exposes the router and oracle to AI
   agents, so an agent can price, compare, and execute an off-ramp in five
   lines — the same primitives used by the web UI.

Non-custodial by construction: every leg is signed by the user, the anchor
takes custody under SEP-24, Stellar enforces atomicity. We never touch funds.

The deeper thesis and the grant resubmission case live in
[**docs/PROPOSAL.md**](docs/PROPOSAL.md); the request/quote/sign/settle flow
and the Soroban oracle wiring live in
[**docs/ARCHITECTURE.md**](docs/ARCHITECTURE.md).

---

## Tech stack

| Layer         | Technology                       |
| ------------- | -------------------------------- |
| Framework     | Next.js 16, React 19, TypeScript |
| Styling       | Tailwind CSS v4                  |
| Data fetching | SWR                              |
| Blockchain    | `@stellar/stellar-sdk` v14       |
| Deployment    | Vercel                           |

---

## Getting Started

**Prerequisites:** Node.js 20+, npm

```bash
# Clone the repository
git clone https://github.com/your-org/stellar-intel.git
cd stellar-intel

# Install dependencies
npm install

# Copy the example environment file and fill in your values
cp .env.example .env.local

# Start the development server
npm run dev
```

The app will be available at `http://localhost:3000`.

```bash
# Type-check the codebase
npm run typecheck

# Lint
npm run lint

# Production build
npm run build
```

---

## Environment Variables

Copy `.env.example` to `.env.local` and set the following variables:

| Variable                         | Required | Default                                      | Description                                            |
| -------------------------------- | -------- | -------------------------------------------- | ------------------------------------------------------ |
| `NEXT_PUBLIC_STELLAR_NETWORK`    | No       | `mainnet`                                    | Stellar network to connect to (`mainnet` or `testnet`) |
| `NEXT_PUBLIC_HORIZON_URL`        | No       | `https://horizon.stellar.org`                | Horizon server URL                                     |
| `NEXT_PUBLIC_STELLAR_EXPERT_URL` | No       | `https://api.stellar.expert/explorer/public` | Stellar Expert API base URL used for transaction links |

All three variables have safe production defaults and are optional for local development.
To point at the Stellar testnet, set:

```bash
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
```

---

## Documentation

The full doc surface lives under [`docs/`](docs/). Start with:

| Document                                               | What it covers                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [docs/PROPOSAL.md](docs/PROPOSAL.md)                   | Grant thesis: execution-layer framing, intent primitive, reputation oracle moat.     |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)           | System diagram, intent router, Soroban oracle, MCP/agent surface, SEP-10/24/38 flow. |
| [docs/ROADMAP.md](docs/ROADMAP.md)                     | Milestone waves v1.0 → v5, with tickable per-wave scope.                             |
| [docs/INTENT_API.md](docs/INTENT_API.md)               | Intent schema, signing rules, replay protection, `curl` + TS snippets.               |
| [docs/ANCHOR_REPUTATION.md](docs/ANCHOR_REPUTATION.md) | Scoring methodology, composite formula, dispute process.                             |
| [docs/ORACLE_SPEC.md](docs/ORACLE_SPEC.md)             | Soroban contract interface, consumer examples, publisher whitelist policy.           |
| [docs/MCP.md](docs/MCP.md)                             | Tool list, `claude mcp add` instructions, example prompts, agent-safety notes.       |
| [docs/SECURITY.md](docs/SECURITY.md)                   | Non-custodial guarantee, key handling, disclosure email, supply-chain policy.        |
| [docs/FAQ.md](docs/FAQ.md)                             | "Is this custodial?", "what if an anchor fails?", "how are we different?".           |

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request.

All contributors are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Good places to start:

- Issues tagged [`good-first-issue`](https://github.com/Ezedike-Evan/stellar-intel/labels/good-first-issue) — scoped, unblocked, reviewer-ready.
- Issues tagged [`help-wanted`](https://github.com/Ezedike-Evan/stellar-intel/labels/help-wanted) — larger tickets actively looking for owners.
- Anchor integrations — see [docs/ANCHOR_ONBOARDING.md](docs/ANCHOR_ONBOARDING.md).

Every contributor merged during OSS week is credited by name in the grant
resubmission document.

---

## Contributors

Thanks to everyone who has shipped code, docs, designs, or anchor integrations
for Stellar Intel.

<!-- Contributors auto-updated by .github/workflows/contributors.yml -->

<table>
  <tr>
    <td align="center" width="140">
      <a href="https://github.com/Ezedike-Evan">
        <img src="https://github.com/Ezedike-Evan.png?size=100" width="80" height="80" alt="Evan Ezedike" /><br />
        <sub><b>Evan Ezedike</b></sub>
      </a><br />
      <sub>Creator &amp; maintainer</sub><br />
      <sub>💻 📖 🏗️ 🚧</sub>
    </td>
    <td align="center" width="140">
      <a href="https://github.com/Ezedike-Evan/stellar-intel/blob/main/CONTRIBUTING.md">
        <img src="https://avatars.githubusercontent.com/u/0?v=4&size=100" width="80" height="80" alt="Your name here" style="opacity:0.5" /><br />
        <sub><b>Your name here</b></sub>
      </a><br />
      <sub>Open a PR →</sub>
    </td>
  </tr>
</table>

Emoji key follows the [all-contributors](https://allcontributors.org/docs/en/emoji-key)
spec: 💻 code · 📖 docs · 🎨 design · 🏗️ infrastructure · 🚧 maintenance · 🔌 anchor integration.

---

## License

[MIT](LICENSE)
