import type { Metadata } from 'next';
import ApiPlayground from '@/components/docs/ApiPlayground';

export const metadata: Metadata = {
  title: 'Interactive API Reference',
  description:
    'Explore every Stellar Intel endpoint with live try-it panels — rates, reputation, leaderboard, off-ramp intent, and public scores — directly from your browser.',
};

export default function ApiDocsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-primary-text">Interactive API Reference</h1>
        <p className="mt-2 text-lg text-secondary-text">
          Explore every endpoint with live try-it panels. Requests default to{' '}
          <strong>this deployment</strong> — production is available from the environment selector
          below, and write requests against it carry a warning.
        </p>
      </div>

      <div className="rounded-xl border border-status-unknown/40 bg-bg-sunken p-4 /50">
        <p className="text-sm text-status-unknown">
          <strong>Note:</strong> Some endpoints require authentication headers or specific
          parameters. See{' '}
          <a href="/docs/auth" className="underline">
            Auth & Rate Limits
          </a>{' '}
          for details.
        </p>
      </div>

      <ApiPlayground />
    </div>
  );
}
