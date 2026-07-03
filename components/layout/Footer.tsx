import Link from 'next/link';
import { sha, buildTime } from '@/lib/version';

const REPO_URL = 'https://github.com/ezedike-evan/stellar-intel';
const DISCORD_URL = 'https://discord.gg/stellar';

const FOOTER_COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/', label: 'Home' },
      { href: '/offramp', label: 'Off-ramp' },
      { href: '/anchors', label: 'Anchors' },
    ],
  },
  {
    title: 'Docs',
    links: [
      { href: `${REPO_URL}#readme`, label: 'Overview', external: true },
      { href: `${REPO_URL}/blob/main/docs/FAQ.md`, label: 'FAQ', external: true },
      {
        href: `${REPO_URL}/blob/main/docs/ARCHITECTURE.md`,
        label: 'Architecture',
        external: true,
      },
    ],
  },
  {
    title: 'Community',
    links: [
      { href: REPO_URL, label: 'GitHub', external: true },
      { href: `${REPO_URL}/discussions`, label: 'Discussions', external: true },
      { href: DISCORD_URL, label: 'Discord', external: true },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: `${REPO_URL}/blob/main/LICENSE`, label: 'License', external: true },
      { href: `${REPO_URL}/blob/main/docs/NON_CUSTODY.md`, label: 'Non-custody', external: true },
      {
        href: `${REPO_URL}/blob/main/CODE_OF_CONDUCT.md`,
        label: 'Code of Conduct',
        external: true,
      },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-border bg-background/95">
      <div className="mx-auto max-w-7xl px-4 py-10 pb-24 md:py-12 md:pb-10">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title} className="space-y-3">
              <h2 className="text-sm font-semibold text-primary-text">{column.title}</h2>
              <ul className="space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {'external' in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-secondary-text transition-colors hover:text-primary-text"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-secondary-text transition-colors hover:text-primary-text"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 text-sm text-secondary-text md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="font-medium text-primary-text">Stellar Intel</p>
            <p>Real-time rate comparison on Stellar.</p>
          </div>

          <div className="flex flex-col gap-2 text-xs md:items-end">
            <p>
              Built on{' '}
              <a
                href="https://stellar.org"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                Stellar
              </a>
            </p>
            {sha ? (
              <p>
                v{sha}
                {buildTime ? ` · ${new Date(buildTime).toLocaleString()}` : ''}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </footer>
  );
}
