import { Skeleton } from '@/components/ui/skeleton';

/**
 * Covers the track overview and every lesson. The group-level loading.tsx is
 * dashboard-shaped, which would make the layout jump when a two-column reading
 * view arrives instead.
 */
export default function Loading() {
  return (
    <div className="grid grid-cols-1 gap-10 xl:grid-cols-[16rem_1fr]">
      <span className="sr-only" role="status">
        Loading the track
      </span>

      <Skeleton className="h-96 w-full" />

      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-full max-w-[62ch]" />
        <Skeleton className="h-4 w-full max-w-[58ch]" />
        <Skeleton className="aspect-square w-full max-w-[46rem]" />
      </div>
    </div>
  );
}
