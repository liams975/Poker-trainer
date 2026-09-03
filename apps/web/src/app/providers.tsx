'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
