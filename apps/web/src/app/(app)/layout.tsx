import type { ReactNode } from 'react';

import { IdentifyUser } from '@/components/analytics/identify-user';
import { CommandPalette } from '@/components/nav/command-palette';
import { buildDestinations, type LessonLink } from '@/components/nav/destinations';
import { AppNav } from '@/components/nav/app-nav';
import { requireUser } from '@/lib/auth/dal';
import { lessonLinks } from '@/lib/lessons/links';

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

  /**
   * The palette's lesson entries. A content problem costs the palette its
   * lesson section and nothing else — the shell wraps every page in the app,
   * so a throw here would take all of them down to make a jump list slightly
   * better.
   */
  let lessons: readonly LessonLink[];
  try {
    lessons = await lessonLinks();
  } catch {
    lessons = [];
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppNav email={user.email ?? ''} />
      <IdentifyUser userId={user.id} />
      <CommandPalette destinations={buildDestinations(lessons)} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
