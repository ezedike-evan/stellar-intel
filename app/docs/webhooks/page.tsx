import type { Metadata } from 'next';
import { CodeBlock } from '@/components/docs/CodeBlock';

export const metadata: Metadata = {
  title: 'Webhooks',
  description:
    'Receive signed event notifications from Stellar Intel — intent created, settled and failed, reputation events, and anchor health changes — without polling the API.',
};

const EVENTS: { kind: string; description: string; emitted: boolean }[] = [
  {
    kind: 'intent.created',
    description: 'An off-ramp intent is accepted for routing',
    emitted: true,
  },
  {
    kind: 'intent.settled',
    description: 'An intent reaches a terminal completed state',
    emitted: true,
  },
  {
    kind: 'intent.failed',
    description: 'An intent reaches a terminal failed state',
    emitted: true,
  },
  {
    kind: 'reputation.event_written',
    description: 'A new outcome row is appended to the reputation log',
    emitted: true,
  },
  {
    kind: 'anchor.health_status_changed',
    description: "An anchor's health status transitions (e.g. healthy to degraded)",
    emitted: false,
  },
];

export default function WebhooksPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary-text">Webhooks</h1>
        <p className="mt-2 text-lg text-secondary-text">
          Receive signed event notifications from the Stellar Intel platform.
        </p>
      </div>

      <div className="rounded-xl border border-status-unknown/40 bg-bg-sunken p-5 /50">
        <p className="text-sm font-medium text-status-unknown">
          Status: Rolling out — delivery is live for four of the five event kinds.
        </p>
        <p className="mt-1 text-sm text-status-unknown">
          <code>anchor.health_status_changed</code> can be subscribed to but is not yet emitted.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Overview</h2>
        <p className="text-secondary-text">
          Webhooks let your application receive notifications when events happen on the Stellar
          Intel platform, without polling. Each delivery is an HMAC-SHA256 signed HTTP POST to your
          HTTPS endpoint.
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
              {EVENTS.map((event) => (
                <tr key={event.kind}>
                  <td className="px-4 py-3 font-mono text-xs text-accent">{event.kind}</td>
                  <td className="px-4 py-3 text-secondary-text">
                    {event.description}
                    {event.emitted ? null : <span> (not yet emitted)</span>}
                  </td>
                </tr>
              ))}
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
  "id": "3f2a1b4c-...",
  "kind": "intent.settled",
  "createdAt": "2026-07-28T12:00:00.000Z",
  "payload": { ... }
}`}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Registering a Webhook</h2>
        <p className="text-secondary-text">
          To register a webhook endpoint, send a POST request to the subscriptions API. The server
          generates the signing secret and returns it <strong>once</strong> in the response, so
          store it immediately.
        </p>
        <CodeBlock
          language="bash"
          code={`curl -sX POST https://stellar-intel.vercel.app/api/webhooks/subscriptions \\
  -H 'x-admin-key: YOUR_ADMIN_SECRET_KEY' \\
  -H 'content-type: application/json' \\
  -d '{
    "url": "https://your-app.com/webhooks/stellar-intel",
    "events": ["intent.settled", "intent.failed"]
  }'`}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Signature Verification</h2>
        <p className="text-secondary-text">
          Each delivery carries two headers: <code>x-webhook-signature</code>, formatted as{' '}
          <code>t=&lt;unix_seconds&gt;,v1=&lt;hex_hmac&gt;</code>, and{' '}
          <code>x-webhook-timestamp</code>, the same timestamp. The HMAC-SHA256 is computed over{' '}
          <code>{'`${t}.${rawBody}`'}</code> with your subscription secret. Use the raw body exactly
          as received, compare in constant time, and reject timestamps more than 300 seconds old.
        </p>
        <CodeBlock
          language="typescript"
          code={`import { createHmac, timingSafeEqual } from 'crypto';

function verify(secret: string, header: string, rawBody: string): boolean {
  const parts: Record<string, string> = {};
  for (const seg of header.split(',')) {
    const eq = seg.indexOf('=');
    if (eq !== -1) parts[seg.slice(0, eq)] = seg.slice(eq + 1);
  }

  const { t, v1 } = parts as { t?: string; v1?: string };
  if (!t || !v1) return false;

  const timestamp = parseInt(t, 10);
  if (Number.isNaN(timestamp)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) return false; // 5-minute window

  const expected = createHmac('sha256', secret).update(\`\${timestamp}.\${rawBody}\`).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'));
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
            • Respond with a <code>2xx</code> status quickly and process the event asynchronously
          </li>
          <li>
            • Any non-2xx response or timeout is retried: up to 5 attempts (the first plus 4
            retries, backed off 1, 2, 4 and 8 seconds)
          </li>
          <li>
            • Deliveries that exhaust their attempts are dead-lettered and visible at{' '}
            <code>GET /api/webhooks/failures</code> (admin key required)
          </li>
          <li>• Store the raw payload and verify the signature before processing</li>
          <li>
            • Idempotency: process by <code>id</code> to handle duplicate deliveries
          </li>
        </ul>
      </section>
    </div>
  );
}
