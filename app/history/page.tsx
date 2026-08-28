import Link from 'next/link';

export default function HistoryPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-primary-text">Transaction history</h1>
      <p className="mt-3 text-sm text-fg-muted">
        Coming soon. Once available, this page will list every off-ramp you&apos;ve completed
        through Stellar Intel.
      </p>
      <Link
        href="/offramp"
        className="mt-6 inline-block text-sm font-medium text-accent hover:underline dark:text-accent"
      >
        Back to off-ramp
      </Link>
    </div>
  );
}
