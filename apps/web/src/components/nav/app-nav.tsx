import Link from 'next/link';

import { Wordmark } from '@/components/brand/wordmark';
import { signOut } from '@/lib/auth/actions';

import { NavLinks } from './nav-links';

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
    <header className="border-b border-line bg-canvas">
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-[1440px] items-stretch gap-12 px-14">
        <Link href="/dashboard" className="flex items-center">
          <Wordmark />
        </Link>

        <NavLinks />

        <div className="ml-auto flex items-center gap-6">
          {/* Discoverability, for the same reason the drill has a "Shortcuts (?)"
              button: a keyboard interface nobody knows about is one nobody
              uses. Not a button — pressing it is the thing to learn. The
              palette is the book's index, so that is what it is called. */}
          <span className="hidden items-center gap-2 font-mono text-xs text-ink-muted lg:flex">
            <kbd className="border border-line px-1.5 py-0.5 font-mono text-2xs">⌘K</kbd>
            <span>Index</span>
          </span>

          <span className="hidden max-w-48 truncate text-sm text-ink-muted xl:inline" title={email}>
            {email}
          </span>
          <form action={signOut} className="flex items-center">
            <button
              type="submit"
              className="text-sm text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      </nav>
    </header>
  );
}
