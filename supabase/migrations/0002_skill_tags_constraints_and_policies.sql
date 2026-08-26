-- 0002_skill_tags_constraints_and_policies.sql
--
-- 0001 created the schema but was never applied to a database. Standing the
-- local stack up in Phase 4 is the first time it has been exercised, and
-- reading it against docs/04-data-model.md and CLAUDE.md turned up four gaps.
-- This migration closes them. 0001 is left untouched: it is already on
-- origin/main, and CLAUDE.md's "never edit an applied migration" exists
-- precisely to avoid relitigating whether a given case is the exception.
--
--   1. handle_new_user() is security definer with a mutable search_path.
--   2. The skill-tag vocabulary is declared in TypeScript but not enforced.
--   3. Child content tables are readable past their parent's published flag.
--   4. Client-written columns have no CHECK constraints.
--
-- Plus one thing 0001 could not have known: this CLI version no longer
-- auto-exposes new tables to the Data API roles, so nothing in 0001 is
-- actually reachable without the explicit GRANTs in sections 0 and 5.

-- ============================================================
-- 0. Privileges
--
-- Grants and RLS are independent layers, and both must allow an operation.
-- 0001 wrote the policies; without grants the policies never get consulted
-- because PostgREST cannot reach the table at all. Default deny means anon
-- gets nothing here, not even a chance to be filtered by a policy.
-- ============================================================

grant usage on schema public to anon, authenticated, service_role;

-- Supabase ships a default privilege that hands anon and authenticated
-- `Dxtm` — TRUNCATE, REFERENCES, TRIGGER, MAINTAIN — on every table `postgres`
-- creates in this schema:
--
--   postgres | public | r | {anon=Dxtm/postgres,authenticated=Dxtm/postgres,...}
--
-- That is not default deny. TRUNCATE is not filtered by RLS, so a role holding
-- it can empty a table it cannot read a single row of; TRIGGER lets it attach
-- a trigger that then fires with the privileges of whoever writes next. Revoke
-- what 0001's tables already inherited...
revoke all on all tables in schema public from anon, authenticated;

-- ...and stop the inheritance itself, so this is fixed once rather than
-- re-litigated in every future migration. Without this line every table
-- Phase 5 onward adds arrives TRUNCATE-able by any signed-in user, and the
-- catalog guard at the bottom of this file becomes the only thing standing
-- between that and production.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

-- Content. RLS narrows these further to published rows only.
grant select on
  tracks, modules, lessons,
  range_chart_sets, range_charts,
  drill_templates, achievements
  to authenticated;

-- User-scoped data. RLS scopes every one of these to the caller's own rows.
grant select, insert, update on profiles to authenticated;
grant select, insert, update, delete on
  drill_sessions, lesson_progress,
  skill_stats, review_queue, streaks, user_achievements
  to authenticated;

-- Append-only ledgers: no update, no delete, enforced by privilege rather
-- than by trusting every future policy edit to remember.
--
-- drill_attempts is here and not in the list above because CLAUDE.md derives
-- totals from event tables, and skill_stats/review_queue are both derived from
-- this one. A log its own author can rewrite is not something you can
-- recompute from, so an attempt is a fact once graded. If a later phase turns
-- out to genuinely need to amend one, that is a one-line grant in a new
-- migration — the reverse, withdrawing a privilege clients already depend on,
-- is the hard direction.
grant select, insert on drill_attempts, xp_events to authenticated;

-- Read only. Writes come from an Edge Function with the service role.
-- Never grant insert/update/delete here. See docs/01-architecture.md §2.
grant select on entitlements to authenticated;

-- The service_role grant is deliberately at the BOTTOM of this file, not
-- here: `grant on all tables` binds to the tables that exist at the moment it
-- runs, and skill_tags is created further down. Granting here would leave the
-- content sync script unable to write the one table it must write first.

-- ============================================================
-- 1. Skill-tag vocabulary
--
-- docs/04-data-model.md: "Define the vocabulary in packages/content and
-- constrain the column against it. Free-text tags will fragment within a week
-- and silently break weak-spot detection."
--
-- A table, not a hardcoded list in SQL: packages/content/src/skill-tags.ts
-- stays the source of truth and `pnpm content:sync` seeds this from it, so
-- the vocabulary cannot drift between the two.
-- ============================================================

create table skill_tags (
  tag        text primary key,
  label      text not null default '',
  created_at timestamptz not null default now(),
  -- Same shape the engine's chart validator enforces on skillTags.
  constraint skill_tags_shape check (tag ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$')
);

alter table skill_tags enable row level security;

-- The default-privileges revoke in section 0 should already have stopped this
-- table inheriting anything. Said explicitly anyway: this is the only table
-- created *after* that revoke, so it is the one place where reordering the
-- file would silently reintroduce the Dxtm grant.
revoke all on skill_tags from anon, authenticated;

create policy "skill_tags: read" on skill_tags for select to authenticated using (true);

grant select on skill_tags to authenticated;

-- Scalar columns get a real foreign key.
alter table skill_stats
  add constraint skill_stats_skill_tag_fkey
  foreign key (skill_tag) references skill_tags(tag) on delete restrict;

alter table review_queue
  add constraint review_queue_skill_tag_fkey
  foreign key (skill_tag) references skill_tags(tag) on delete restrict;

alter table profiles
  add constraint profiles_placement_skill_tag_fkey
  foreign key (placement_skill_tag) references skill_tags(tag) on delete set null;

-- Array columns cannot have a foreign key, so they get a trigger.
--
-- Deliberately NOT a CHECK constraint calling a lookup function: a CHECK that
-- reads another table is not re-validated when that table changes, and it
-- makes pg_dump/restore ordering-dependent — which would make `db:reset`
-- fragile in exactly the way this phase exists to disprove.
create or replace function public.validate_skill_tags()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  unknown_tags text[];
begin
  select array_agg(t) into unknown_tags
  from unnest(new.skill_tags) as t
  where not exists (select 1 from public.skill_tags s where s.tag = t);

  if unknown_tags is not null then
    raise exception
      'unknown skill tag(s): %; the vocabulary lives in packages/content/src/skill-tags.ts',
      array_to_string(unknown_tags, ', ')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger lessons_skill_tags_valid
  before insert or update of skill_tags on lessons
  for each row execute function public.validate_skill_tags();

create trigger range_charts_skill_tags_valid
  before insert or update of skill_tags on range_charts
  for each row execute function public.validate_skill_tags();

create trigger drill_templates_skill_tags_valid
  before insert or update of skill_tags on drill_templates
  for each row execute function public.validate_skill_tags();

create trigger drill_attempts_skill_tags_valid
  before insert or update of skill_tags on drill_attempts
  for each row execute function public.validate_skill_tags();

-- ============================================================
-- 2. security definer hardening, and capturing timezone at signup
--
-- A security definer function with a mutable search_path runs its body with
-- the definer's privileges against whatever schema the *caller* points it at.
-- Pinning search_path to '' and schema-qualifying every reference is the
-- fix; Supabase's own linter flags the unpinned form.
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- docs/04-data-model.md: "Timezone is load-bearing for streak logic; capture
-- it at signup." 0001 defaulted every profile to UTC, which the same doc
-- warns against ("Never default to UTC silently"). The client passes the
-- browser's zone in raw_user_meta_data at signup; a missing or bogus value
-- falls back to UTC rather than failing the signup, because a bad timezone
-- must never cost someone their account.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tz text := nullif(new.raw_user_meta_data ->> 'timezone', '');
begin
  if tz is null or not exists (
    select 1 from pg_catalog.pg_timezone_names where name = tz
  ) then
    tz := 'UTC';
  end if;

  insert into public.profiles (id, display_name, timezone)
  values (
    new.id,
    -- Truncated, not rejected, for the same reason the timezone falls back
    -- rather than raising. profiles_display_name_len caps this at 50, and a
    -- CHECK violation inside this trigger aborts the enclosing signup — the
    -- user gets an HTTP 500 and no account. Google is enabled in config.toml
    -- and OAuth providers put long names in metadata routinely, so this is a
    -- path a real person hits, not a hypothetical.
    left(nullif(new.raw_user_meta_data ->> 'display_name', ''), 50),
    tz
  );

  insert into public.streaks (user_id) values (new.id);
  insert into public.entitlements (user_id) values (new.id);

  return new;
end;
$$;

-- ============================================================
-- 3. Content visibility follows the parent's published flag
--
-- 0001 gated tracks and range_chart_sets on `published` but left their
-- children `using (true)`, so an unpublished chart set's charts were fully
-- readable by any signed-in user. Content could not be staged.
-- ============================================================

drop policy "modules: read" on modules;
create policy "modules: read" on modules for select to authenticated
using (exists (
  select 1 from tracks t where t.id = modules.track_id and t.published
));

drop policy "lessons: read" on lessons;
create policy "lessons: read" on lessons for select to authenticated
using (exists (
  select 1 from modules m
  join tracks t on t.id = m.track_id
  where m.id = lessons.module_id and t.published
));

drop policy "charts: read" on range_charts;
create policy "charts: read" on range_charts for select to authenticated
using (exists (
  select 1 from range_chart_sets s
  where s.id = range_charts.chart_set_id and s.published
));

-- ============================================================
-- 4. Constraints at the DB boundary
--
-- CLAUDE.md: "Validate all user input at the DB boundary with constraints,
-- not just in TS." Everything below is a column a client writes directly.
-- ============================================================

-- Identity ---------------------------------------------------

-- Stable, not immutable, so this is not a textbook CHECK. The alternative is
-- no validation at all on the single most load-bearing column for streaks,
-- and pg_timezone_names is a system catalog that always exists — the
-- restore-ordering hazard that rules out lookup-table CHECKs does not apply.
create or replace function public.is_iana_timezone(tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz);
$$;

alter table profiles
  add constraint profiles_timezone_valid check (public.is_iana_timezone(timezone)),
  add constraint profiles_display_name_len
    check (display_name is null or char_length(display_name) between 1 and 50);

-- Activity ---------------------------------------------------

alter table drill_attempts
  -- ev_loss is a loss, never a gain. The engine clamps it; the DB says so too.
  add constraint drill_attempts_ev_loss_nonneg check (ev_loss >= 0),
  -- mulberry32 rejects a seed outside uint32, so an out-of-range seed here
  -- would store an attempt that can never be replayed.
  add constraint drill_attempts_seed_uint32 check (seed >= 0 and seed <= 4294967295),
  -- 24 hours, not one. docs/02-roadmap.md lists an untimed drill mode and a
  -- Study Mode, where a user can legitimately leave a spot open over lunch;
  -- a one-hour ceiling silently costs them the attempt on the way back.
  -- The bound exists to catch a unit mix-up, not to police thinking time.
  add constraint drill_attempts_response_ms_sane
    check (response_ms is null or (response_ms >= 0 and response_ms <= 86400000)),
  add constraint drill_attempts_chart_version_len
    check (char_length(chart_version) between 1 and 64),
  -- Mirrors the engine's SIZED_ACTIONS rule: bet and raise carry a size,
  -- everything else must not.
  add constraint drill_attempts_size_matches_action
    check ((user_action in ('bet', 'raise')) = (user_size is not null)),
  add constraint drill_attempts_user_size_positive
    check (user_size is null or user_size > 0),
  add constraint drill_attempts_scenario_object check (jsonb_typeof(scenario) = 'object'),
  add constraint drill_attempts_frequencies_array
    check (jsonb_typeof(frequencies) = 'array' and jsonb_array_length(frequencies) > 0);

alter table drill_sessions
  add constraint drill_sessions_spots_planned_sane
    check (spots_planned is null or spots_planned between 1 and 500),
  add constraint drill_sessions_completed_after_started
    check (completed_at is null or completed_at >= started_at),
  add constraint drill_sessions_config_object check (jsonb_typeof(config) = 'object');

-- Progress ---------------------------------------------------

alter table skill_stats
  add constraint skill_stats_counts_sane
    check (attempts >= 0 and correct >= 0 and correct <= attempts),
  add constraint skill_stats_ewma_is_a_rate check (ewma_accuracy between 0 and 1),
  add constraint skill_stats_ev_loss_nonneg check (avg_ev_loss >= 0);

alter table review_queue
  add constraint review_queue_interval_positive check (interval_days > 0),
  add constraint review_queue_ease_positive check (ease > 0);

-- Gamification -----------------------------------------------

-- Bounded, not server-authoritative. docs/01-architecture.md §3 accepts that
-- client-computed values are honour-system in v1, requiring only that they
-- "never gate money or unlock content". These bounds stop a typo or a bored
-- user from writing a number that breaks every future chart and total; they
-- are not an anti-cheat mechanism and are not pretending to be one.
alter table xp_events
  add constraint xp_events_amount_bounded check (amount between -100000 and 100000),
  add constraint xp_events_reason_len check (char_length(reason) between 1 and 64);

alter table streaks
  add constraint streaks_nonneg check (current_streak >= 0 and longest_streak >= 0),
  add constraint streaks_longest_is_longest check (longest_streak >= current_streak);

-- Content ----------------------------------------------------

alter table range_charts
  add constraint range_charts_ranges_object check (jsonb_typeof(ranges) = 'object'),
  -- v1 is locked to 6-max 100bb (CLAUDE.md), but pinning the exact values
  -- here would need a migration to seed any other format. Sane bounds catch
  -- a transposed or zeroed sync without blocking a future table size.
  add constraint range_charts_table_size_sane check (table_size between 2 and 10),
  add constraint range_charts_stack_depth_sane check (stack_depth between 1 and 500);

alter table drill_templates
  add constraint drill_templates_config_object check (jsonb_typeof(config) = 'object');

alter table lessons
  add constraint lessons_body_object check (jsonb_typeof(body) = 'object');

-- Note on indexes: docs/04 asks for (user_id, skill_tag) on drill_attempts.
-- 0001's GIN index on the skill_tags array serves that access pattern —
-- skill_tags is text[], not a scalar — so no additional index is added here.

-- ============================================================
-- 5. Privileges, part two
--
-- Runs last so it covers skill_tags, which section 1 created after the first
-- grant block. `grant on all tables` is a snapshot of what exists when it
-- executes, not a standing rule.
-- ============================================================

grant all on all tables in schema public to service_role;

-- Called from a CHECK constraint, so it is evaluated by whoever is writing the
-- row rather than by the table owner. Postgres grants EXECUTE on a new
-- function to PUBLIC, so naming the two roles below narrows nothing on its
-- own — the revoke is what makes the grant mean something.
revoke all on function public.is_iana_timezone(text) from public;
grant execute on function public.is_iana_timezone(text) to authenticated, service_role;

-- Belt and braces: prove the two roles ended up where this migration says they
-- should, rather than trusting that every grant above landed.
--
-- These check every privilege type, not just SELECT. An earlier draft checked
-- SELECT alone and passed green while anon held TRUNCATE on skill_tags — a
-- guard that only looks where you already looked is not a guard.
do $$
declare
  all_privs  text[] := array['select', 'insert', 'update', 'delete',
                             'truncate', 'references', 'trigger', 'maintain'];
  -- What authenticated is granted deliberately in section 0. Anything outside
  -- this set is DDL-adjacent: TRUNCATE bypasses RLS entirely, TRIGGER and
  -- REFERENCES are how a user reaches rows they cannot select.
  user_privs text[] := array['select', 'insert', 'update', 'delete'];
  leaked     text;
begin
  select string_agg(format('%s (%s)', c.relname, p.priv), ', ' order by c.relname, p.priv)
    into leaked
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(all_privs) as p(priv)
  where n.nspname = 'public'
    and c.relkind = 'r'
    and has_table_privilege('anon', c.oid, p.priv);

  if leaked is not null then
    raise exception 'anon holds privileges it should not: %', leaked;
  end if;

  select string_agg(format('%s (%s)', c.relname, p.priv), ', ' order by c.relname, p.priv)
    into leaked
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(all_privs) as p(priv)
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not p.priv = any(user_privs)
    and has_table_privilege('authenticated', c.oid, p.priv);

  if leaked is not null then
    raise exception 'authenticated holds privileges it should not: %', leaked;
  end if;

  select string_agg(c.relname, ', ' order by c.relname) into leaked
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if leaked is not null then
    raise exception 'row level security is not enabled on: %', leaked;
  end if;

  if not has_table_privilege('service_role', 'public.skill_tags', 'insert') then
    raise exception 'service_role cannot write skill_tags, so content sync would fail';
  end if;
end;
$$;
