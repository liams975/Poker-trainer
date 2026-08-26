import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth/dal';

/**
 * The root is a router, not a page. v1 has no marketing site — docs/02 puts
 * that in Phase 11 — so send people to the one useful place: the dashboard if
 * they are signed in, sign-in if they are not.
 *
 * `isPublicPath` treats `/` as public so the proxy lets it through and this
 * decides, rather than the proxy bouncing everyone to sign-in before the
 * signed-in case is even considered.
 */
export default async function RootPage() {
  const user = await getCurrentUser();

  redirect(user ? '/dashboard' : '/sign-in');
}
