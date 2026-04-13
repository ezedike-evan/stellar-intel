'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowDownLeft, ArrowUpRight, Sprout, ArrowLeftRight } from 'lucide-react';
import { clsx } from 'clsx';

const TAB_LINKS = [
  { href: '/offramp', label: 'Off-ramp', icon: ArrowDownLeft },
  { href: '/onramp', label: 'On-ramp', icon: ArrowUpRight },
  { href: '/yield', label: 'Yield', icon: Sprout },
  { href: '/swap', label: 'Swap', icon: ArrowLeftRight },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-center pb-5 md:hidden">
      <nav
        className="flex items-center gap-1 rounded-2xl border border-border bg-background/80 px-2 py-2 shadow-lg shadow-black/10 backdrop-blur-xl dark:shadow-black/40"
        style={{
          boxShadow: '0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.08)',
        }}
      >
        {TAB_LINKS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'relative flex flex-col items-center gap-1 rounded-xl px-5 py-2.5 text-[10px] font-semibold tracking-wide uppercase transition-all duration-200 active:scale-90',
                active ? 'text-accent' : 'text-secondary-text hover:text-primary-text'
              )}
            >
              {/* active background pill */}
              {active && (
                <span
                  className="absolute inset-0 rounded-xl"
                  style={{
                    background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                  }}
                />
              )}

              {/* icon with glow on active */}
              <span
                className="relative z-10 transition-transform duration-200"
                style={
                  active
                    ? {
                        filter: 'drop-shadow(0 0 6px var(--accent))',
                        transform: 'translateY(-1px)',
                      }
                    : {}
                }
              >
                <Icon className={clsx('h-[18px] w-[18px]', active && 'stroke-[2.5]')} />
              </span>

              {/* label */}
              <span className="relative z-10">{label}</span>

              {/* active dot indicator */}
              {active && (
                <span
                  className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full"
                  style={{ background: 'var(--accent)' }}
                />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
