# Stellar Intel

**Find the best rates on Stellar, in real time.**

Stellar Intel is a rate aggregator for the Stellar ecosystem. It compares
off-ramp withdrawal rates, on-ramp deposit fees, yield protocol APYs, and
swap routes across anchors and DeFi protocols — and lets you execute directly
from the same interface.

Built for users sending money home across Africa, Latin America, and Southeast
Asia via Stellar anchors.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS v4 |
| Data fetching | SWR |
| Blockchain | `@stellar/stellar-sdk` v14 |
| Deployment | Vercel |

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

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_STELLAR_NETWORK` | No | `mainnet` | Stellar network to connect to (`mainnet` or `testnet`) |
| `NEXT_PUBLIC_HORIZON_URL` | No | `https://horizon.stellar.org` | Horizon server URL |
| `NEXT_PUBLIC_STELLAR_EXPERT_URL` | No | `https://api.stellar.expert/explorer/public` | Stellar Expert API base URL used for transaction links |

All three variables have safe production defaults and are optional for local development.
To point at the Stellar testnet, set:

```bash
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
```

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request.

All contributors are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

---

## License

[MIT](LICENSE)
