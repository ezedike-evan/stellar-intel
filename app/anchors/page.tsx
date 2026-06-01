import { Card } from '@/components/ui/Card';
import { CORRIDORS } from '@/constants';
import { Leaderboard } from '@/components/anchors/Leaderboard';
import {
  buildLeaderboardData,
  getLeaderboardDirection,
  getLeaderboardSortKey,
} from '@/lib/reputation';

interface AnchorsPageProps {
  searchParams?: {
    corridor?: string;
    sort?: string;
    direction?: string;
  };
}

export default function AnchorsPage({ searchParams }: AnchorsPageProps) {
  const selectedCorridor = CORRIDORS.some((corridor) => corridor.id === searchParams?.corridor)
    ? searchParams?.corridor
    : null;
  const sortKey = getLeaderboardSortKey(searchParams?.sort);
  const direction = getLeaderboardDirection(searchParams?.direction);
  const leaderboard = buildLeaderboardData(selectedCorridor ?? undefined, sortKey, direction);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="space-y-6">
        <section className="rounded-3xl border border-gray-200 bg-white/80 p-6 shadow-sm shadow-black/5 backdrop-blur-sm dark:border-gray-800 dark:bg-slate-950/80">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-blue-600 dark:text-blue-400">
                Anchor leaderboard
              </p>
              <h1 className="mt-3 text-3xl font-semibold text-gray-900 dark:text-white md:text-4xl">
                The best Stellar anchor reputation scores.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-600 dark:text-gray-300">
                Compare anchors by composite score, fill rate, settle latency, and slippage.
                Filter by corridor and click any column header to sort the leaderboard.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Card className="rounded-3xl border border-gray-200 bg-slate-50 p-4 dark:border-gray-800 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-[0.24em] text-gray-500 dark:text-gray-400">
                  Filtered corridor
                </p>
                <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">
                  {selectedCorridor ?? 'All corridors'}
                </p>
              </Card>
              <Card className="rounded-3xl border border-gray-200 bg-slate-50 p-4 dark:border-gray-800 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-[0.24em] text-gray-500 dark:text-gray-400">
                  Active sort
                </p>
                <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">
                  {sortKey} · {direction}
                </p>
              </Card>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-4">
            <Card className="space-y-4 rounded-3xl border border-gray-200 bg-slate-50 p-6 dark:border-gray-800 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Corridor filter</h2>
              <form action="/anchors" method="get" className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="corridor">
                    Corridor
                  </label>
                  <select
                    id="corridor"
                    name="corridor"
                    defaultValue={selectedCorridor ?? ''}
                    className="w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-300 dark:border-gray-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="">All corridors</option>
                    {CORRIDORS.map((corridor) => (
                      <option key={corridor.id} value={corridor.id}>
                        {corridor.from} → {corridor.to} — {corridor.countryName}
                      </option>
                    ))}
                  </select>
                </div>
                <input type="hidden" name="sort" value={sortKey} />
                <input type="hidden" name="direction" value={direction} />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  Apply filter
                </button>
              </form>
            </Card>
          </aside>

          <section className="space-y-4">
            <Leaderboard
              entries={leaderboard.entries}
              selectedCorridor={leaderboard.corridorId}
              sortKey={leaderboard.sortKey}
              direction={leaderboard.direction}
            />
          </section>
        </section>
      </div>
    </main>
  );
}
