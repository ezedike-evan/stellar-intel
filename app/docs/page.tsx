import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { DOCS_CARD_ROUTES } from './nav';

const CARD_DETAIL: Record<string, { title: string; description: string }> = {
  '/docs/quickstart': {
    title: 'Quickstart',
    description: 'Make your first API call in under 5 minutes.',
  },
  '/docs/api': {
    title: 'Interactive API Reference',
    description: 'Explore every endpoint with live try-it panels.',
  },
  '/docs/auth': {
    title: 'Auth & Rate Limits',
    description: 'Authentication methods, API keys, and rate-limit tiers.',
  },
  '/docs/webhooks': {
    title: 'Webhooks',
    description: 'Receive real-time event notifications from the platform.',
  },
  '/docs/sdks': {
    title: 'SDKs & Libraries',
    description: 'TypeScript, Python, and Rust client libraries.',
  },
  '/docs/mcp': {
    title: 'MCP Tool Docs',
    description: 'Use Stellar Intel through AI agents via the MCP server.',
  },
};

// Derived from the shared route list, so a new /docs page cannot appear in the
// sidebar and silently miss the index grid (#871).
const DOCS_CARDS = DOCS_CARD_ROUTES.map((route) => {
  const detail = CARD_DETAIL[route.href];
  return {
    href: route.href,
    icon: route.icon,
    title: detail?.title ?? route.label,
    description: detail?.description ?? '',
  };
});

export default function DocsHome() {
  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-3xl font-bold text-primary-text">Developer Portal</h1>
        <p className="mt-2 text-lg text-secondary-text">
          Everything you need to integrate Stellar Intel into your wallet, agent, or application.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {DOCS_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={card.href}
              className="group rounded-xl border border-border bg-background p-5 transition-all hover: hover:border-accent/50"
            >
              <div className="border-border bg-bg-sunken mb-3 inline-flex rounded-sm border p-2.5">
                <Icon className="text-secondary-text h-5 w-5" aria-hidden="true" />
              </div>
              <h3 className="mb-1 font-semibold text-primary-text group-hover:text-accent">
                {card.title}
              </h3>
              <p className="text-sm text-secondary-text">{card.description}</p>
              <div className="mt-3 flex items-center gap-1 text-xs font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
                Read more <ArrowRight className="h-3 w-3" />
              </div>
            </Link>
          );
        })}
      </div>

      <div className="rounded-xl border border-border bg-bg-subtle p-6">
        <h2 className="text-xl font-semibold text-primary-text">API Base URL</h2>
        <div className="mt-3 flex items-center gap-2">
          <code className="rounded-md bg-bg-sunken px-3 py-1.5 text-sm font-mono text-primary-text">
            https://stellar-intel.vercel.app
          </code>
          <span className="text-sm text-secondary-text">— Production</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <code className="rounded-md bg-bg-sunken px-3 py-1.5 text-sm font-mono text-primary-text">
            http://localhost:3000
          </code>
          <span className="text-sm text-secondary-text">— Local development</span>
        </div>
      </div>

      <div className="rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold text-primary-text">Quick links</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <a
            href="https://github.com/ezedike-evan/stellar-intel"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-accent hover:underline"
          >
            <ArrowRight className="h-3 w-3" />
            GitHub Repository
          </a>
          <a
            href="/docs/quickstart"
            className="flex items-center gap-2 text-sm text-accent hover:underline"
          >
            <ArrowRight className="h-3 w-3" />
            Quickstart Guide
          </a>
          <a
            href="/docs/api"
            className="flex items-center gap-2 text-sm text-accent hover:underline"
          >
            <ArrowRight className="h-3 w-3" />
            API Reference
          </a>
          <a
            href="/docs/mcp"
            className="flex items-center gap-2 text-sm text-accent hover:underline"
          >
            <ArrowRight className="h-3 w-3" />
            MCP Server
          </a>
        </div>
      </div>
    </div>
  );
}
