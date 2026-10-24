import type { Metadata } from 'next';
import { CodeBlock } from '@/components/docs/CodeBlock';

export const metadata: Metadata = {
  title: 'On-ramp Integration Guide',
  description:
    'Integrate fiat-to-crypto on-ramping on Stellar — fetch quotes, create on-ramp intents, handle trustline XDRs, and launch interactive anchor handoffs.',
};

export default function OnrampDocsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary-text">On-ramp Integration Guide</h1>
        <p className="mt-2 text-lg text-secondary-text">
          A step-by-step developer guide for non-custodial fiat-to-crypto deposits on Stellar.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-bg-subtle p-5">
        <p className="text-sm text-secondary-text">
          <strong>Status: in development.</strong> The on-ramp endpoints and MCP tools described
          below are not live yet. The request body follows the shipped on-ramp intent schema; the
          response fields shown are the planned contract and may change before release.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Overview</h2>
        <p className="text-secondary-text">
          The Stellar Intel on-ramp flow allows wallets, applications, and agents to guide users
          from local fiat currencies (USD, EUR, NGN, BRL, etc.) into Stellar assets such as USDC or
          XLM. The process consists of four main phases:
        </p>
        <ol className="list-inside list-decimal space-y-1 text-sm text-secondary-text">
          <li>
            <strong>Quote</strong>: Query rates, fees, and rail options across available anchors.
          </li>
          <li>
            <strong>Intent Creation</strong>: Register a canonical deposit intent with the
            destination address and funding method.
          </li>
          <li>
            <strong>Trustline Verification</strong>: Sign and submit an{' '}
            <code className="text-accent">unsignedChangeTrustXdr</code> if the wallet does not yet
            trust the asset.
          </li>
          <li>
            <strong>Anchor Handoff</strong>: Launch the interactive{' '}
            <code className="text-accent">handoffUrl</code> for KYC and payment completion.
          </li>
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Step 1: Requesting a Quote</h2>
        <p className="text-secondary-text">
          Retrieve the best rate and fee estimate across supported anchors using the quote endpoint:
        </p>
        <div className="rounded-md bg-bg-subtle p-3 text-sm font-mono text-primary-text">
          GET /api/v1/onramp/quote
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-primary-text">Query Parameters</h3>
            <CodeBlock
              language="text"
              code={`GET /api/v1/onramp/quote?sourceAsset=NGN&destinationAsset=USDC&amount=150000&depositMethod=bank_transfer`}
            />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-primary-text">Response</h3>
            <CodeBlock
              language="json"
              code={`{
  "quoteId": "quote_onramp_8f419c",
  "sourceAsset": "NGN",
  "destinationAsset": "USDC",
  "sourceAmount": "150000.00",
  "destinationAmount": "95.60",
  "rate": "1568.50",
  "fee": {
    "fixed": "500.00",
    "percent": "0.5"
  },
  "anchor": {
    "id": "cowrie",
    "name": "Cowrie Exchange",
    "domain": "cowrie.exchange"
  },
  "expiresAt": "2026-10-17T12:30:00Z"
}`}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">
          Step 2: Creating an On-ramp Intent
        </h2>
        <p className="text-secondary-text">
          Submit the validated parameters to generate a canonical on-ramp intent. The destination
          must be a valid public key (G…):
        </p>
        <div className="rounded-md bg-bg-subtle p-3 text-sm font-mono text-primary-text">
          POST /api/v1/intent/onramp
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-primary-text">Request Body</h3>
            <CodeBlock
              language="json"
              code={`{
  "type": "onramp",
  "sourceAsset": "NGN",
  "destinationAsset": "USDC",
  "amount": "150000.00",
  "sender": "NG123456789012345678",
  "destination": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "depositMethod": "bank_transfer"
}`}
            />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-primary-text">Response</h3>
            <CodeBlock
              language="json"
              code={`{
  "intentId": "onramp_intent_9a4f21",
  "status": "pending_trustline",
  "unsignedChangeTrustXdr": "AAAAAgAAAABn...",
  "handoffUrl": "https://cowrie.exchange/sep24/deposit?transaction_id=...",
  "createdAt": "2026-10-17T12:05:00Z"
}`}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">
          Step 3: Handling <code>unsignedChangeTrustXdr</code>
        </h2>
        <p className="text-secondary-text">
          Before an anchor can credit an issued asset (such as USDC) to a Stellar account, that
          account must have an active trustline. If the account lacks one, the intent response
          includes an <code className="text-accent">unsignedChangeTrustXdr</code>:
        </p>
        <CodeBlock
          language="typescript"
          code={`// Example: Submitting the trustline transaction with Freighter or Stellar SDK
import { signTransaction } from '@stellar/freighter-api';

if (response.unsignedChangeTrustXdr) {
  const signedXdr = await signTransaction(response.unsignedChangeTrustXdr, {
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
  });
  await server.submitTransaction(signedXdr);
}`}
        />
        <p className="text-sm text-secondary-text">
          If the account already holds the required trustline, <code>unsignedChangeTrustXdr</code>{' '}
          will be <code>null</code> and this step can be safely bypassed.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">
          Step 4: Interactive Anchor Handoff (<code>handoffUrl</code>)
        </h2>
        <p className="text-secondary-text">
          Once the trustline is confirmed, launch the{' '}
          <code className="text-accent">handoffUrl</code> in a secure browser tab or in-app webview
          modal. The user completes the anchor&apos;s KYC and receives banking instructions or card
          payment fields.
        </p>
        <div className="rounded-xl border border-border bg-bg-subtle p-5">
          <p className="text-sm text-secondary-text">
            <strong>Callback Notifications:</strong> Anchors send status updates back to the
            application via webhooks or URL postMessage triggers upon successful payment settlement.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">AI Agent &amp; MCP Integration</h2>
        <p className="text-secondary-text">
          Agents using the hosted Model Context Protocol (MCP) server at <code>/api/mcp</code> get
          on-ramp tools that work without access to secret keys:
        </p>
        <ul className="list-inside list-disc space-y-2 text-sm text-secondary-text">
          <li>
            <code className="text-accent">intel.onramp.quote</code>: Returns the best indicative
            deposit estimate across the anchors that serve a corridor.
          </li>
          <li>
            <code className="text-accent">intel.onramp.prepare</code>: Constructs the unsigned
            on-ramp intent and returns the app URL where the user completes the deposit.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Security Model</h2>
        <div className="rounded-xl border border-border bg-bg-subtle p-5">
          <p className="text-sm text-secondary-text">
            <strong>Non-custodial by design:</strong> Stellar Intel does not touch user fiat or
            custody private keys. All deposits occur directly between the user and licensed Stellar
            anchors adhering to SEP-6 and SEP-24 specifications.
          </p>
        </div>
      </section>
    </div>
  );
}
