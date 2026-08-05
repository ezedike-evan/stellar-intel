import ApiPlayground from '@/components/docs/ApiPlayground';

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

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
        <p className="text-sm text-amber-800 dark:text-amber-300">
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
