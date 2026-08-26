# 04 — Data Model

Migration: `supabase/migrations/0001_initial_schema.sql`.

## Principles

**Every table has RLS enabled in the same migration that creates it.** A
table shipped without a policy is a data leak waiting for a user to find it.
Default deny; grant narrowly.

**Event tables over mutable counters.** `xp_events` is append-only and totals
are derived. Counters drift, are hard to audit, and race under concurrency.
An event log lets you recompute, backfill, and answer "why is my XP this
number?" — which you will be asked.

**Content is versioned and attempts reference the version.** When you tune a
range chart, past attempts must stay interpretable. Every `drill_attempt`
stores `chart_version` and `seed`, which means any historical spot can be
regenerated and re-explained exactly as the user saw it.

**Model for v2, populate in v1.** `review_queue` and `entitlements` ship
empty. Adding tables later is easy; backfilling behavioral history you never
recorded is impossible.

## Table groups

### Identity
- `profiles` — extends `auth.users`. Display name, timezone, onboarding state.
  **Timezone is load-bearing** for streak logic; capture it at signup.

### Content (service-role write, authenticated read)
- `tracks` → `modules` → `lessons` — the learning hierarchy
- `range_chart_sets` / `range_charts` — versioned strategy data
- `drill_templates` — scenario generator configs

### Activity
- `drill_sessions` — one row per session; mode, config, aggregate results
- `drill_attempts` — one row per spot. The analytics goldmine. Stores the
  scenario, user action, recommendation, grade tier, EV loss, seed,
  chart_version, and response time.

`drill_attempts` will be your largest table by far. Index on
`(user_id, created_at desc)` and `(user_id, skill_tag)`. Partitioning is
unnecessary at v1 scale but the schema shouldn't fight it later.

### Progress
- `lesson_progress` — per-user, per-lesson status
- `skill_stats` — per-user, per-skill-tag rollup with EWMA accuracy.
  Denormalized on purpose: weak-spot detection runs on every dashboard load
  and shouldn't aggregate millions of attempts. Updated by trigger or
  Edge Function on attempt insert.
- `review_queue` — **v2 SRS scaffold.** Empty in v1.

### Gamification
- `xp_events` — append-only ledger
- `streaks` — current, longest, last_active_date (a date, not a timestamp —
  streaks are day-granular in the user's timezone)
- `achievements` / `user_achievements`

### Commerce
- `entitlements` — **service-role write only.** Client reads, never writes.
  Empty and unused in v1; the seam exists so v2 doesn't require a refactor.

## Skill tags

The connective tissue between lessons, drills, and weak-spot detection. A
controlled vocabulary — not free text — so that a lesson teaching
`preflop.rfi.late_position` and a drill exercising it and a weakness detected
in it all reference the same key.

Suggested shape: `preflop.rfi.utg`, `preflop.vs_3bet.btn`,
`preflop.blind_defense.bb_vs_btn`, `concept.pot_odds`, `concept.blockers`.

Define the vocabulary in `packages/content` and constrain the column against
it. Free-text tags will fragment within a week and silently break weak-spot
detection.

## Streak logic warning

Streaks are the single most common source of "why did my streak break?"
support complaints. Rules to implement and test explicitly:

- Day boundaries use the **user's** timezone from `profiles`, not UTC, not
  the server's.
- `last_active_date` is a `date`, compared by date arithmetic.
- Test across DST transitions in both directions, and across a timezone change
  by the user mid-streak.
- Decide and document the grace-period policy before writing the code.

## RLS test cases (Phase 4 exit criteria)

Write these as actual tests, not manual checks:

1. User A cannot `SELECT` user B's `drill_attempts`.
2. User A cannot `INSERT` a `drill_attempt` with `user_id = B`.
3. User A cannot `UPDATE` their own `entitlements` row.
4. Anonymous (unauthenticated) requests read zero rows from every user table.
5. Authenticated users can read content tables but cannot write them.
6. A user can read and write their own rows in every user-scoped table.
---

## What Phase 4 decided

`0001` created the schema but was never applied to a database. Standing the
local stack up was the first time it ran, and these are the decisions that
came out of that. Migration: `supabase/migrations/0002_skill_tags_constraints_and_policies.sql`.

### Grants are a second layer, and they are not automatic

The Supabase CLI no longer auto-exposes new `public` tables to the Data API
roles. RLS policies and table grants are independent: a policy on a table
nobody can reach never runs, and a grant without a policy leaks everything.
`0002` grants explicitly and gives `anon` nothing at all, so anonymous
requests fail at the privilege layer before RLS is even consulted.

Supabase also ships a *default privilege* handing `anon` and `authenticated`
`Dxtm` — TRUNCATE, REFERENCES, TRIGGER, MAINTAIN — on every table `postgres`
creates in `public`. **TRUNCATE is not filtered by RLS**, so that grant let any
signed-in user empty a table they could not read a single row of. `0002`
revokes it from the existing tables *and* revokes the default itself, so tables
added in later phases start denied instead of each migration having to
remember. A new table therefore needs its grants written out, `service_role`
included.

`supabase/tests/database/03_rls_anon.sql` asserts this from the catalog rather
than from a list — it fails if *any* table in `public` ever becomes reachable
by `anon`, including one that does not exist yet. It checks all eight privilege
types: an earlier version checked only SELECT and passed green while `anon`
held TRUNCATE on `skill_tags`.

### Skill tags are enforced by the database

The vocabulary lives in `packages/content/src/skill-tags.ts` and is synced
into a `skill_tags` table. Scalar columns (`skill_stats.skill_tag`,
`review_queue.skill_tag`, `profiles.placement_skill_tag`) have a real foreign
key. The `text[]` columns have a trigger, because Postgres has no array
foreign key — and deliberately *not* a `CHECK` calling a lookup function,
which is not re-validated when the referenced table changes and makes
`pg_dump`/restore ordering-dependent.

To add a tag: edit `skill-tags.ts`, then `pnpm content:sync`.

### XP and streaks are bounded, not server-authoritative

`docs/01-architecture.md` §3 accepts that client-computed values are
honour-system in v1, requiring only that they never gate money or unlock
content. So `xp_events.amount` and the streak counters carry range
constraints that stop a typo or a bored user from writing a number that
breaks every future chart — and nothing more. **This is an accepted risk, not
an oversight.** A user can still award themselves XP. If leaderboards ever
become competitive, this needs an Edge Function.

`entitlements` is the opposite and stays that way: read-only to its owner,
with `01_rls_user_data.sql` proving a user cannot update or insert their own
row.

### `drill_attempts` is append-only, like `xp_events`

`authenticated` holds `select, insert` on it and nothing else. `skill_stats`
and `review_queue` are both derived from this table, and CLAUDE.md's rule is to
derive totals from event tables rather than store mutable counters — you cannot
recompute from a log its own author can rewrite. A graded attempt is a fact.

Account deletion still removes the rows: it cascades from `auth.users` and runs
as the service role, which is not subject to these grants. If a later phase
genuinely needs to amend an attempt, that is a one-line grant in a new
migration; withdrawing a privilege clients already depend on is the hard
direction, which is why the restrictive default is the one taken now.

### The content sync reconciles, it does not just add

`pnpm content:sync` deletes rows `packages/content` no longer declares, scoped
to the current chart set, and reads every count back from the database instead
of printing the length of what it sent. Upserting alone made the sync additive:
retiring a chart found to be wrong silently did not happen, while the output
still showed a clean number. Since `docs/01-architecture.md` makes "retune
without a deploy" the point of this script, and retiring a bad chart is a form
of retuning, additive-only was a hole rather than a simplification.

A tag some user's `skill_stats` still references is `on delete restrict`, so
pruning it fails loudly with the constraint named rather than leaving a row
behind quietly.

### Timezone is captured at signup, and validated

`handle_new_user()` reads `raw_user_meta_data->>'timezone'` so the browser's
zone lands in `profiles` instead of a silent UTC default. A missing or bogus
value falls back to UTC rather than failing the signup — a bad timezone must
never cost someone their account — and a `CHECK` against `pg_timezone_names`
stops a bad one being written later.

The same rule applies to the display name, which is truncated to 50 rather than
rejected. The trigger runs inside the `auth.users` insert, so anything it raises
rolls the whole signup back and the caller gets an HTTP 500 with no account.
Google is enabled and OAuth providers return long names routinely, so this is a
path a real person hits.

### Still open

- **Grace-period policy for streaks is not decided.** The warning above still
  stands, and Phase 9 must settle it before writing streak logic.
- **Google OAuth is configured but untested.** It cannot be exercised without
  real client credentials; email/password is what the suites cover.
- **`streaks_longest_is_longest` forbids the intermediate state** where
  `current_streak` is bumped before `longest_streak`. Phase 9 must write both
  columns in one statement, not two.
- **`profiles_timezone_valid` depends on the contents of `pg_timezone_names`.**
  The catalog always exists, so the restore-ordering hazard that rules out
  lookup-table CHECKs does not apply — but a zone dropped in a future tzdata
  release would fail CHECK revalidation on restore for rows already holding it.
