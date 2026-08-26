import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/auth/actions';

/**
 * The signed-in chrome. Monochrome by rule — docs/05 reserves saturated colour
 * for strategy data, and nav is the most tempting place to break that.
 *
 * Sign-out is a form posting to a Server Action rather than a link, because a
 * GET that mutates session state can be triggered by a prefetch or an <img>
 * tag on another site. It is a state change, so it is a POST.
 */
export function AppNav({ email }: { email: string }) {
  return (
    <header className="border-b border-line bg-surface">
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-6 px-6"
      >
        <Link href="/dashboard" className="font-display text-sm font-semibold tracking-tight">
          Poker Trainer
        </Link>

        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-ink-muted sm:inline" title={email}>
            {email}
          </span>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </nav>
    </header>
  );
}
