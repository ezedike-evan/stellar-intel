import type { Metadata } from 'next';
import Link from 'next/link';
import {
  getAdjudicationLog,
  verifyChain,
  summarizeLog,
  type AdjudicationEntry,
} from '@/lib/reputation/adjudication-log';
import { ReputationStoreUnavailableError } from '@/lib/reputation/pool';
import { DisputeLogTable } from '@/components/disputes/DisputeLogTable';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';
const REPO_URL = 'https://github.com/ezedike-evan/stellar-intel';
const TITLE = 'Dispute log — Stellar Intel';
const DESCRIPTION =
  'Public, append-only dispute adjudication log and hash chain verification for Stellar off-ramp anchors.';

export const revalidate = 300;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: new URL('/disputes', SITE_URL).toString(),
    images: [
      {
        url: new URL('/opengraph-image', SITE_URL).toString(),
        width: 1200,
        height: 630,
        alt: TITLE,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

async function loadAdjudicationEntries(): Promise<AdjudicationEntry[]> {
  try {
    return await getAdjudicationLog().list();
  } catch (error) {
    if (error instanceof ReputationStoreUnavailableError) {
      return [];
    }
    throw error;
  }
}

export default async function DisputesPage() {
  const entries = await loadAdjudicationEntries();
  const summary = summarizeLog(entries);
  const verification = verifyChain(entries);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:py-12 space-y-8">
      {/* Page Header */}
      <div className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-primary-text md:text-3xl">
          Dispute log
        </h1>
        <p className="max-w-3xl text-sm text-secondary-text">
          A public, append-only record of disputes filed against Stellar anchors and their
          adjudications. Every entry is linked to its predecessor by cryptographic hash, ensuring
          complete auditability and tampering detection.
        </p>

        {/* Chain Verification Badge */}
        <div className="pt-2">
          {verification.ok ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-status-up/30 bg-status-up/10 px-3 py-1 text-xs font-medium text-status-up">
              <span>●</span>
              <span>
                Hash chain verified · {verification.length}{' '}
                {verification.length === 1 ? 'entry' : 'entries'} · head{' '}
                <span className="font-mono">{verification.head.slice(0, 12)}</span>…
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-full border border-status-down/30 bg-status-down/10 px-3 py-1 text-xs font-medium text-status-down">
              <span>●</span>
              <span>Hash chain broken at entry {verification.brokenAtSeq}</span>
            </div>
          )}
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div className="rounded-lg border border-border bg-bg-subtle p-4">
          <div className="text-xs font-medium text-secondary-text">Filed</div>
          <div className="mt-1 text-2xl font-bold text-primary-text">{summary.filed}</div>
        </div>
        <div className="rounded-lg border border-border bg-bg-subtle p-4">
          <div className="text-xs font-medium text-secondary-text">Open</div>
          <div className="mt-1 text-2xl font-bold text-primary-text">{summary.open}</div>
        </div>
        <div className="rounded-lg border border-border bg-bg-subtle p-4">
          <div className="text-xs font-medium text-secondary-text">Resolved</div>
          <div className="mt-1 text-2xl font-bold text-primary-text">{summary.resolved}</div>
        </div>
        <div className="rounded-lg border border-border bg-bg-subtle p-4">
          <div className="text-xs font-medium text-secondary-text">Accepted</div>
          <div className="mt-1 text-2xl font-bold text-status-up">{summary.accepted}</div>
        </div>
        <div className="rounded-lg border border-border bg-bg-subtle p-4">
          <div className="text-xs font-medium text-secondary-text">Rejected</div>
          <div className="mt-1 text-2xl font-bold text-secondary-text">{summary.rejected}</div>
        </div>
      </div>

      {/* Main Table */}
      <DisputeLogTable entries={entries} />

      {/* Links Footer */}
      <div className="border-t border-border pt-4 text-xs text-secondary-text flex flex-wrap items-center gap-x-4 gap-y-2">
        <span>
          Raw data:{' '}
          <Link
            href="/api/v1/disputes/log"
            className="text-accent underline hover:text-accent-hover transition-colors"
          >
            /api/v1/disputes/log
          </Link>
        </span>
        <span>•</span>
        <span>
          Governance & policy:{' '}
          <a
            href={`${REPO_URL}/blob/main/docs/DISPUTES.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline hover:text-accent-hover transition-colors"
          >
            docs/DISPUTES.md
          </a>
        </span>
      </div>
    </div>
  );
}
