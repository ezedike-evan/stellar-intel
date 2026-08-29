import { CodeBlock } from '@/components/docs/CodeBlock';

export default function WebhooksPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary-text">Webhooks</h1>
        <p className="mt-2 text-lg text-secondary-text">
          Receive real-time event notifications from the Stellar Intel platform.
        </p>
      </div>

      <div className="rounded-xl border border-status-unknown/40 bg-bg-sunken p-5 /50">
        <p className="text-sm font-medium text-status-unknown">
          Status: Planned — Webhook support is on the roadmap (v2.3+).
        </p>
        <p className="mt-1 text-sm text-status-unknown">
          Below is the proposed design. Implementation is tracked on GitHub.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Overview</h2>
        <p className="text-secondary-text">
          Webhooks allow your application to receive real-time notifications when events happen on
          the Stellar Intel platform — such as intent settlements, dispute updates, or reputation
          score changes — without polling.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Event Types</h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-subtle">
                <th className="px-4 py-3 text-left font-medium text-primary-text">Event</th>
                <th className="px-4 py-3 text-left font-medium text-primary-text">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-3 font-mono text-xs text-accent">intent.settled</td>
                <td className="px-4 py-3 text-secondary-text">
                  An off-ramp intent was successfully settled
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-xs text-accent">intent.failed</td>
                <td className="px-4 py-3 text-secondary-text">
                  An off-ramp intent failed to settle
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-xs text-accent">dispute.created</td>
                <td className="px-4 py-3 text-secondary-text">
                  A new dispute was filed against an outcome
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-xs text-accent">dispute.resolved</td>
                <td className="px-4 py-3 text-secondary-text">
                  A dispute was accepted or rejected by an admin
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-xs text-accent">anchor.onboarded</td>
                <td className="px-4 py-3 text-secondary-text">
                  A new anchor was registered in the fleet
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-xs text-accent">publisher.tick</td>
                <td className="px-4 py-3 text-secondary-text">
                  Publisher completed a batch submission to the oracle
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Payload Format</h2>
        <p className="text-secondary-text">
          Webhooks are delivered via HTTP POST to your registered endpoint with the following
          payload structure:
        </p>
        <CodeBlock
          language="json"
          code={`{
  "event": "intent.settled",
  "id": "evt_abc123",
  "createdAt": "2026-07-28T12:00:00Z",
  "data": {
    "intentHash": "abc...",
    "anchorId": "cowrie",
    "corridor": "usdc-ngn",
    "amount": "100.00",
    "status": "completed"
  }
}`}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Registering a Webhook</h2>
        <p className="text-secondary-text">
          To register a webhook endpoint, send a POST request to the admin API:
        </p>
        <CodeBlock
          language="bash"
          code={`curl -sX POST https://stellar-intel.vercel.app/api/admin/webhooks \\
  -H 'x-admin-key: YOUR_ADMIN_SECRET_KEY' \\
  -H 'content-type: application/json' \\
  -d '{
    "url": "https://your-app.com/webhooks/stellar-intel",
    "events": ["intent.settled", "intent.failed"],
    "secret": "your-webhook-secret"
  }'`}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Signature Verification</h2>
        <p className="text-secondary-text">
          Each webhook payload is signed with the webhook secret using HMAC-SHA256. The signature is
          sent in the <code>X-StellarIntel-Signature</code> header. Verify it to ensure the payload
          came from Stellar Intel:
        </p>
        <CodeBlock
          language="typescript"
          code={`// TypeScript verification example
import { createHmac, timingSafeEqual } from 'crypto';

function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  try {
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}`}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Best Practices</h2>
        <ul className="space-y-2 text-sm text-secondary-text">
          <li>
            • Respond with <code>200 OK</code> within 5 seconds to acknowledge receipt
          </li>
          <li>
            • Return a <code>4xx</code> status to signal a permanent failure (we will disable the
            webhook)
          </li>
          <li>
            • Return a <code>5xx</code> or timeout for automatic retry (up to 3 times with
            exponential backoff)
          </li>
          <li>• Store the raw payload and verify the signature before processing</li>
          <li>
            • Idempotency: process by <code>event.id</code> to handle duplicate deliveries
          </li>
        </ul>
      </section>
    </div>
  );
}
