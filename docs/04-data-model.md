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