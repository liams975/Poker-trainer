import { Skeleton } from '@/components/ui/skeleton';

/**
 * Review-shaped rather than dashboard-shaped: a chart, then two stacks of rows.
 * The group-level loading.tsx would flash a card grid and then jump.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <span className="sr-only" role="status">
        Loading your history
      </span>

      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-8 w-full max-w-2xl" />

      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
