import type { ReactNode } from 'react';

import { AppNav } from '@/components/nav/app-nav';
import { requireUser } from '@/lib/auth/dal';

/**
 * The signed-in shell, and the authoritative auth check for everything under
 * it.
 *
 * `src/proxy.ts` will usually have redirected a signed-out visitor before this
 * renders, but that is a UX convenience, not the boundary — Next's own guide
 * says the proxy layer "should not be your only line of defense". This runs
 * `getUser()` against the auth server on every request. Postgres RLS is the
 * third layer beneath it.
 *
 * Any route group added later that must be signed-in belongs under here, so
 * that the check is inherited rather than re-implemented per page.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-dvh flex-col">
      <AppNav email={user.email ?? ''} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
