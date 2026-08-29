import { CodeBlock } from '@/components/docs/CodeBlock';

export default function AuthPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary-text">Authentication & Rate Limits</h1>
        <p className="mt-2 text-lg text-secondary-text">
          Most public endpoints do not require authentication. Admin and internal endpoints use
          bearer token auth.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Authentication Methods</h2>

        <div className="rounded-xl border border-border p-5">
          <h3 className="font-semibold text-primary-text">Public endpoints (no auth)</h3>
          <p className="mt-1 text-sm text-secondary-text">
            The following endpoints are publicly accessible without any authentication:
          </p>
          <ul className="mt-2 space-y-1 text-sm text-secondary-text">
            <li>
              <code className="text-accent">GET /api/rates/[corridor]</code>
            </li>
            <li>
              <code className="text-accent">POST /api/intent/offramp</code>
            </li>
            <li>
              <code className="text-accent">GET /api/reputation/[anchor]</code>
            </li>
            <li>
              <code className="text-accent">GET /api/reputation/leaderboard</code>
            </li>
            <li>
              <code className="text-accent">GET /api/publisher/health</code>
            </li>
            <li>
              <code className="text-accent">GET /api/snapshot</code>
            </li>
            <li>
              <code className="text-accent">GET /v1/public/scores</code>
            </li>
          </ul>
        </div>

        <div className="rounded-xl border border-border p-5">
          <h3 className="font-semibold text-primary-text">Admin endpoints (header auth)</h3>
          <p className="mt-1 text-sm text-secondary-text">
            Admin endpoints require the <code>X-Admin-Key</code> header set to the{' '}
            <code>ADMIN_SECRET_KEY</code> environment variable.
          </p>
          <CodeBlock
            language="bash"
            code={`curl -s https://stellar-intel.vercel.app/api/admin/disputes \\
  -H 'x-admin-key: YOUR_ADMIN_SECRET_KEY'`}
          />
          <ul className="mt-2 space-y-1 text-sm text-secondary-text">
            <li>
              <code className="text-accent">GET /api/admin/disputes</code>
            </li>
            <li>
              <code className="text-accent">POST /api/admin/disputes</code>
            </li>
          </ul>
        </div>

        <div className="rounded-xl border border-border p-5">
          <h3 className="font-semibold text-primary-text">Cron endpoints (bearer token)</h3>
          <p className="mt-1 text-sm text-secondary-text">
            Internal cron-triggered endpoints require an{' '}
            <code>Authorization: Bearer CRON_SECRET</code> header.
          </p>
          <CodeBlock
            language="bash"
            code={`curl -s https://stellar-intel.vercel.app/api/publisher/tick \\
  -H 'authorization: Bearer YOUR_CRON_SECRET'`}
          />
          <ul className="mt-2 space-y-1 text-sm text-secondary-text">
            <li>
              <code className="text-accent">POST /api/publisher/tick</code>
            </li>
            <li>
              <code className="text-accent">POST /api/reputation/reconcile</code>
            </li>
            <li>
              <code className="text-accent">POST /api/reputation/refresh</code>
            </li>
          </ul>
        </div>

        <div className="rounded-xl border border-border p-5">
          <h3 className="font-semibold text-primary-text">Signed intent verification</h3>
          <p className="mt-1 text-sm text-secondary-text">
            The dispute endpoint uses <strong>Ed25519 cryptographic signature verification</strong>.
            The request body includes a signature over the <code>intentHash</code> that the server
            verifies before accepting the dispute.
          </p>
          <CodeBlock
            language="bash"
            code={`curl -sX POST https://stellar-intel.vercel.app/api/reputation/dispute \\
  -H 'content-type: application/json' \\
  -d '{
    "intentHash": "abc123...",
    "publicKey": "GABC...",
    "signature": "base64-signature...",
    "anchorId": "cowrie",
    "reason": "Rate did not match quoted amount"
  }'`}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Rate Limits</h2>
        <p className="text-secondary-text">
          Rate limiting is applied on a per-IP basis using a sliding window algorithm. The following
          limits are currently enforced:
        </p>

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-subtle">
                <th className="px-4 py-3 text-left font-medium text-primary-text">Endpoint</th>
                <th className="px-4 py-3 text-left font-medium text-primary-text">Limit</th>
                <th className="px-4 py-3 text-left font-medium text-primary-text">Window</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-3 font-mono text-xs text-accent">
                  GET /api/rates/[corridor]
                </td>
                <td className="px-4 py-3 text-secondary-text">90 requests</td>
                <td className="px-4 py-3 text-secondary-text">60 seconds</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-xs text-accent">
                  POST /api/intent/offramp
                </td>
                <td className="px-4 py-3 text-secondary-text">20 requests</td>
                <td className="px-4 py-3 text-secondary-text">60 seconds</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-xs text-accent">
                  POST /api/reputation/dispute
                </td>
                <td className="px-4 py-3 text-secondary-text">10 requests</td>
                <td className="px-4 py-3 text-secondary-text">24 hours (per publicKey)</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-xs text-accent">
                  GET /api/publisher/health
                </td>
                <td className="px-4 py-3 text-secondary-text">120 requests</td>
                <td className="px-4 py-3 text-secondary-text">60 seconds</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-xs text-accent">GET /v1/public/scores</td>
                <td className="px-4 py-3 text-secondary-text">60 requests</td>
                <td className="px-4 py-3 text-secondary-text">60 seconds</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-xs text-accent">Other public endpoints</td>
                <td className="px-4 py-3 text-secondary-text">Coming soon</td>
                <td className="px-4 py-3 text-secondary-text">—</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-border bg-bg-subtle p-5">
          <h3 className="font-semibold text-primary-text">Rate limit response</h3>
          <p className="mt-1 text-sm text-secondary-text">
            When a rate limit is exceeded, the API returns a <code>429 Too Many Requests</code>{' '}
            response:
          </p>
          <CodeBlock
            language="json"
            code={`{
  "code": "TOO_MANY_REQUESTS",
  "message": "Rate limit exceeded. Retry after 45 seconds."
}`}
          />
          <p className="mt-2 text-sm text-secondary-text">
            The response includes a <code>Retry-After</code> header with the number of seconds to
            wait, and <code>X-RateLimit-Remaining</code> headers on successful requests.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Best Practices</h2>
        <ul className="space-y-2 text-sm text-secondary-text">
          <li>• Cache rate responses client-side for at least 15 seconds</li>
          <li>• Use conditional requests (ETag / If-None-Match) where supported</li>
          <li>• Implement exponential backoff on 429 responses</li>
          <li>
            • Use the <code>Cache-Control</code> headers returned by the API
          </li>
          <li>
            • Consider using the snapshot endpoint for periodic polling instead of the live rates
            endpoint
          </li>
        </ul>
      </section>
    </div>
  );
}
