'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

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
