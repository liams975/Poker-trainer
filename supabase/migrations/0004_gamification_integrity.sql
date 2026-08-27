-- ============================================================
-- Phase 9: making the progress ledger reconcilable
-- ============================================================
--
-- No new tables. `xp_events`, `streaks`, `skill_stats`, `achievements` and
-- `user_achievements` have all existed since 0001 with RLS and grants; this
-- migration adds the integrity the code that finally writes them depends on.
--
-- docs/04-data-model.md is explicit that XP and streaks are bounded but *not*
-- server-authoritative — `authenticated` holds `insert` on `xp_events` and a
-- determined user can still award themselves XP. That is an accepted risk and
-- nothing here pretends to close it. What these constraints do is stop the
-- app's own write path from producing a ledger that does not add up, which is
-- a different problem and one that would be ours.

-- ------------------------------------------------------------
-- 1. An award happens once
-- ------------------------------------------------------------
--
-- The load-bearing line of this migration.
--
-- XP is awarded when a drill session closes, through a PATCH the browser can
-- retry — on a flaky connection, on a double click, on a React effect that
-- fires twice. Without this index a retry doubles the award, and because
-- CLAUDE.md derives every total from the ledger rather than storing a counter,
-- every screen would then faithfully report the inflated number. There would be
-- nothing to notice and nothing to reconcile against.
--
-- `ref_id` carries the session id, or the lesson id for a completion. Partial,
-- because `daily_goal` has no uuid to key on: it is guarded instead by a read
-- scoped to the user's local day, which is application logic rather than a
-- constraint. That asymmetry is deliberate and is the one award whose
-- idempotency the database does not enforce.
create unique index xp_events_once_per_ref
  on xp_events (user_id, reason, ref_id)
  where ref_id is not null;

-- ------------------------------------------------------------
-- 2. The reason vocabulary is closed
-- ------------------------------------------------------------
--
-- `reason` was `text` with only a length check, which means a typo in one
-- release ships a second, parallel ledger nobody is summing. A CHECK rather
-- than a lookup table: this vocabulary belongs to the code that awards XP, not
-- to content, and there is nothing to join to. It mirrors `XP_REASONS` in
-- packages/engine/src/progress/xp.ts — adding a reason means a migration, which
-- is the deliberate, reviewable act it should be.
alter table xp_events
  add constraint xp_events_reason_known
    check (reason in ('drill_session', 'lesson_complete', 'daily_goal', 'achievement'));

-- ------------------------------------------------------------
-- 3. An achievement the evaluator cannot read is invisible
-- ------------------------------------------------------------
--
-- Not a style nit. An achievement whose `criteria.kind` the engine does not
-- implement syncs cleanly, sits in the table, and never unlocks for anybody —
-- no error, no empty box on a page, nothing to notice. The engine's validator
-- catches it at content-load time and the sync catches it before it writes;
-- this is the third layer, at the boundary, per CLAUDE.md's rule about
-- validating with constraints and not only in TypeScript.
--
-- The kinds mirror `ACHIEVEMENT_KINDS` in
-- packages/engine/src/progress/achievements.ts.
alter table achievements
  add constraint achievements_criteria_known
    check (
      jsonb_typeof(criteria) = 'object'
      and criteria->>'kind' in ('spots', 'streak', 'lessons', 'mastery')
    );

-- ------------------------------------------------------------
-- 4. Reading a rollup on every dashboard load
-- ------------------------------------------------------------
--
-- `skill_stats` is keyed (user_id, skill_tag), so a lookup by user alone
-- already uses the primary key's leading column. What has no index is the
-- attempt scan the rollup is *rebuilt* from, which filters by session and by
-- user-plus-recency. `drill_attempts (user_id, created_at desc)` from 0001
-- covers the second; this covers the first, which every session close now runs.
create index if not exists drill_attempts_session_idx
  on drill_attempts (session_id);
