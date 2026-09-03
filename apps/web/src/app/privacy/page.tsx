import Link from 'next/link';

export const metadata = { title: 'Privacy · Poker Trainer' };

/**
 * What the app collects, in plain words.
 *
 * Phase 10 adds two third-party services that see your traffic. Shipping those
 * without saying so anywhere would be the kind of thing this codebase has
 * refused all the way through — the same instinct that made Study Mode's
 * scoring note explicit and that keeps `docs/04` honest about XP being
 * honour-system.
 *
 * Written to be true rather than to be comprehensive. Every claim below is
 * checkable against the code.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-xs text-ink-muted underline underline-offset-4 hover:text-ink"
        >
          ← Poker Trainer
        </Link>
        <h1 className="font-display text-2xl font-semibold">Privacy</h1>
        <p className="text-sm text-ink-muted">
          Short, because there is not much to say.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-sm font-semibold">What the app stores about you</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-ink-muted">
          <li>
            Your email address and, if you sign in with Google, whatever name Google supplies.
          </li>
          <li>
            Your timezone, captured from your browser at sign-up. It is used to decide when your
            day ends, which is what makes a streak mean anything.
          </li>
          <li>
            Every drill answer: the spot, what you chose, how it was graded, and how long you
            took. This is the record everything else — your stats, your weak spots, your
            progress — is calculated from.
          </li>
          <li>Which lessons you have finished, and your XP and streak.</li>
        </ul>
        <p className="text-sm text-ink-muted">
          It is stored in Supabase (Postgres, hosted in the US). Database policies restrict every
          row to the account that owns it.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-sm font-semibold">Third parties</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-ink-muted">
          <li>
            <strong className="text-ink">PostHog</strong> — product analytics. It records which
            pages you open and a small, fixed list of events, so I can see where people get stuck.
            It is configured not to write a cookie: nothing about you persists in your browser
            between visits, and you are only linked to an account after you sign in.
          </li>
          <li>
            <strong className="text-ink">Sentry</strong> — error reporting. When something breaks
            it receives the error, the page it happened on, and your account id so a report can be
            matched to the thing you were doing. It does not receive your drill history.
          </li>
          <li>
            <strong className="text-ink">Vercel</strong> hosts the app and{' '}
            <strong className="text-ink">Google</strong> handles sign-in if you use that button.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-sm font-semibold">What it does not do</h2>
        <p className="text-sm text-ink-muted">
          No advertising, no third-party ad or marketing trackers, and nothing is sold or shared
          with anyone beyond the services listed above. There is no payment of any kind, so no
          payment details exist.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-sm font-semibold">Deleting your account</h2>
        <p className="text-sm text-ink-muted">
          Ask, and it goes. Deleting the account removes every row above with it — the database
          cascades from your user record, so nothing is left behind under a different key.
        </p>
      </section>
    </div>
  );
}
