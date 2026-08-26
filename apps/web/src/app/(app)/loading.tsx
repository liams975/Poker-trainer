import { Skeleton } from '@/components/ui/skeleton';

/**
 * Shown while a protected page's server work resolves. Mirrors the dashboard's
 * shape — strip, two-column body — so the layout does not jump when the real
 * content arrives.
 *
 * The pulse is a CSS animation, so the global prefers-reduced-motion block
 * flattens it to a static block for anyone who asks for that.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <span className="sr-only" role="status">
        Loading
      </span>

      <Skeleton className="h-20 w-full" />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}
