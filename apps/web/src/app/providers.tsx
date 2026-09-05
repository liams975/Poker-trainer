'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';

import { initAnalytics } from '@/lib/analytics/client';

/**
 * TanStack Query, per docs/01-architecture.md's split: Query owns server state,
 * Zustand will own ephemeral drill-session state when Phase 7 needs it.
 *
 * The client is created in `useState` rather than at module scope. A
 * module-level client is shared across every request the server handles, which
 * on a server-rendered app means one user's cached data can be served to
 * another. Per-component-instance is the documented pattern and the only safe
 * one here.
 */
export function Providers({ children }: { children: ReactNode }) {
  /**
   * PostHog starts here rather than at module scope. `posthog.init` touches
   * `window`, so at module scope it would run during the server render of every
   * page. An effect runs only in the browser and only once — `initAnalytics`
   * guards against React's development double-invoke itself.
   */
  useEffect(() => {
    initAnalytics();
  }, []);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Long enough that navigating back to the dashboard does not
            // refetch everything, short enough that a drill result shows up.
            staleTime: 60_000,
            // The window regaining focus is not evidence the data changed, and
            // a refetch storm on alt-tab is the usual first complaint.
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/**
       * `reducedMotion="user"` is **load-bearing, not a nicety.**
       *
       * `globals.css` collapses animation and transition durations under
       * `prefers-reduced-motion: reduce`, globally, so a component cannot
       * forget it. That block has no effect whatsoever on anything in here:
       * Motion animates by writing inline styles frame by frame, which no
       * stylesheet can reach.
       *
       * And the test that guards the CSS path — `e2e/shell.spec.ts` — probes a
       * `div.animate-pulse`, so it would have stayed green while every
       * animation added in Phase 11 ignored the user's stated preference. A
       * test that keeps passing after the thing it names stops being true is
       * worse than no test, so `e2e/motion.spec.ts` observes a real Motion
       * element instead.
       *
       * `LazyMotion` with the `domAnimation` feature bundle, and `m.*` rather
       * than `motion.*` at the call sites: it is the documented way to keep the
       * animation features out of the initial chunk.
       */}
      <MotionConfig reducedMotion="user">
        <LazyMotion features={domAnimation} strict>
          {children}
        </LazyMotion>
      </MotionConfig>
    </QueryClientProvider>
  );
}
