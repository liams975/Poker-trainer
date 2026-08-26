import { Skeleton } from '@/components/ui/skeleton';

/**
 * The group-level loading.tsx is dashboard-shaped, which would make the layout
 * jump when a 13x13 matrix arrives instead. This mirrors the explorer.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <span className="sr-only" role="status">
        Loading range charts
      </span>

      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-32 w-full" />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_20rem]">
        <Skeleton className="aspect-square w-full max-w-[46rem]" />
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}
