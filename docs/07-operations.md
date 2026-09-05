# Operations

What "shipped" actually means. Everything here is a thing you might need to do
at 11pm with the app misbehaving, so it is written to be followed rather than
read.

## Where it lives

| | |
|---|---|
| App | Vercel — `poker-trainer-virid-delta.vercel.app` |
| Database + auth | Supabase project `ssihhzuplflundwhjbxk`, region `us-east-1` |
| Errors | Sentry, org `poker-trainer`, project `poker-trainer` |
| Analytics | PostHog, US cloud |
| Source | GitHub `liams975/Poker-trainer`, deploys from `main` |

## Deploying

Push to `main`. Vercel builds and promotes automatically; a branch gets a
preview URL. There is no manual deploy step and no staging environment — with
one developer, a preview deployment is the staging environment.

**Content and schema do not deploy with the app.** That is deliberate
(`docs/01-architecture.md`: retune without a deploy) and it means two things
have to be run by hand when they change:

```bash
supabase db push                    # migrations
pnpm content:sync --confirm-remote  # charts, templates, lessons, achievements
```

Both need `.env.production.local` at the repo root, holding `SUPABASE_URL`,
`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. It is gitignored. The sync
refuses a non-local URL without `--confirm-remote`, which is the whole point of
the flag.

**Order matters when both change**: migrations first, then content. Content
sync writes rows whose columns the migration may have just added.

## Rolling back

**The app**: Vercel dashboard → Deployments → the last good one →
*Promote to Production*. Instant, and it does not touch the database.

**A migration**: there is no down-migration. Write a new forward migration that
undoes it. `docs/04-data-model.md` and CLAUDE.md both say never edit an applied
migration, and that applies hardest when you are in a hurry.

**Content**: `packages/content` is the source of truth, so revert the commit and
re-run the sync. `pnpm content:sync` reconciles — it deletes rows the package no
longer declares — so a revert genuinely reverts rather than leaving the old rows
alongside the new.

Careful with the two prunes that destroy user data: retiring a lesson cascades
to `lesson_progress`, and retiring an achievement cascades to
`user_achievements`. The script counts the rows and refuses; `--drop-progress`
overrides it, and should be a decision rather than a reflex.

## Known limits, and what to do about them

**The free Supabase tier pauses a project after 7 days with no database
activity.** The first request afterwards fails while it wakes. Opening the app
once a week prevents it; the dashboard is in the Supabase console under the
project name.

**Email is rate-limited.** Supabase's built-in sender is documented as
unsuitable for production and allows a handful of messages an hour. Sign-up
confirmations go through it, so a burst of new users will not all receive their
link. The fix is a custom SMTP provider, which needs a domain that can be
verified — so it arrives with the custom domain and not before. Until then,
treat "many people signing up at once" as a thing to schedule rather than
something the system handles.

**The database is in `us-east-1`.** From the UK that is roughly 80–100ms per
round trip, and the dashboard makes several. It is not changeable without
recreating the project. If the dashboard ever feels slow from Europe, this is
why, and the answer is a second project in `eu-west-2` plus a migration of the
data — not a code change.

**The favicon is SVG-only.** `apps/web/src/app/icon.svg` is picked up by Next's
metadata file convention, and Safari before 16 ignores an SVG `rel=icon` — those
users get the browser default in the tab and nothing else is affected. A
`favicon.ico` fallback would fix it and needs a binary asset generated outside
the repo, which is why it has not been done rather than because it was missed.

**XP is honour-system.** `authenticated` holds `insert` on `xp_events`, so a
determined user can award themselves XP. `docs/04-data-model.md` accepts this
explicitly. `drill_attempts` and `skill_stats` are the ones that matter and are
server-written; if XP ever gates anything, this needs an Edge Function first.

## Rotating a key

**Supabase anon key**: Supabase dashboard → API keys → roll. Then update
`NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel (all environments) and redeploy. The
key is public by design — it is only safe because RLS is correct, which is why
`docs/01` ranks RLS gaps as the number one attack surface.

**Supabase service role key**: same place. Update `.env.production.local`. It is
not in Vercel and must not be — the app has no use for it.

**Sentry auth token**: Sentry → Settings → Auth Tokens → revoke and recreate
with `project:releases` and `org:read`. Update `SENTRY_AUTH_TOKEN` in Vercel.
Losing it costs source maps on the next build, nothing else.

**Google OAuth secret**: Google Cloud Console → Credentials → the web client →
reset. Paste into Supabase → Authentication → Google. Sign-in with Google is
broken between the two steps.

## Restoring the database

The free tier keeps daily backups for 7 days: Supabase dashboard → Database →
Backups → *Restore*. It restores the whole project to a point in time; there is
no per-table restore.

Before restoring anything, know that `drill_attempts` is append-only and every
progress figure is derived from it — so restoring the database to an earlier
point silently rolls back XP, streaks, weak spots and lesson progress together,
consistently. That is the right behaviour and worth saying out loud, because
"just restore the one table" is not available and would produce a state none of
the derivations expect.

## When something breaks

1. **Sentry** first — the digest shown on the app's own error page is the
   correlation id. `error.tsx` and `global-error.tsx` both report.
2. **Vercel runtime logs** for anything Sentry missed. The free tier keeps about
   an hour, so grab them before doing anything else.
3. **Supabase logs** (dashboard → Logs) for auth and Postgres errors,
   particularly `502 An invalid response was received from the upstream server`,
   which is Kong holding a stale IP and is a restart rather than a code problem.

Browser error reports are routed through `/monitoring` on the app's own origin
rather than straight to Sentry, so an ad blocker cannot silently stop them.

## Verifying a deploy

The e2e suite runs against a local stack, not production — it signs up real
users and would fill the production database with them. After a deploy, the
manual check is the exit criterion itself:

landing → sign up → confirmation email → onboarding → placement → lesson →
drill → review.

Two parts of that chain exist nowhere else: **Google sign-in** and the **email
confirm route**. Both were written in Phase 5 and can only be exercised against
a deployed URL with real credentials.
