import { Skeleton } from '@/components/ui/skeleton';

/**
 * Covers both drill routes. The group-level loading.tsx is dashboard-shaped,
 * which would make the layout jump when the config panel arrives instead.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <span className="sr-only" role="status">
        Loading drill
      </span>

      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-80 w-full max-w-2xl" />
    </div>
  );
}
