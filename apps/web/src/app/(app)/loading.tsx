import { Skeleton } from '@/components/ui/skeleton';

/**
 * Shown while a protected page's server work resolves. Mirrors the Desk's
 * shape — a masthead beside the TODAY panel, then the contents list beside the
 * rail — so the layout does not jump when the real content arrives.
 *
 * The pulse is a CSS animation, so the global prefers-reduced-motion block
 * flattens it to a static block for anyone who asks for that.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-24">
      <span className="sr-only" role="status">
        Loading
      </span>

      <div className="grid grid-cols-1 gap-16 xl:grid-cols-[minmax(0,1fr)_28rem]">
        <div className="flex flex-col gap-7">
          <Skeleton className="h-3 w-72" />
          <Skeleton className="h-36 w-full max-w-2xl" />
          <Skeleton className="h-13 w-60" />
        </div>
        <Skeleton className="h-72 w-full" />
      </div>

      <div className="grid grid-cols-1 gap-16 xl:grid-cols-[minmax(0,1fr)_28rem]">
        <div className="flex flex-col gap-5">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  );
}
