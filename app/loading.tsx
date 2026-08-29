import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Shown by Next.js while a route segment's data/JS is loading. Only replaces
 * the page content — Header/Footer/BottomNav live in the persistent root
 * layout and render immediately regardless. Kept generic (a title block +
 * a card block) since it covers every route, not routes with dedicated
 * loading states of their own.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-full max-w-md" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
