-- 0001_initial_schema.sql
-- Poker trainer v1 schema.
-- RULE: every table enables RLS in this file. No exceptions.

-- ============================================================
-- Enums
-- ============================================================

create type position_6max as enum ('UTG','HJ','CO','BTN','SB','BB');
create type poker_action  as enum ('fold','check','call','bet','raise','allin');
create type grade_tier    as enum ('optimal','acceptable','inaccurate','blunder');
create type lesson_status as enum ('locked','available','in_progress','completed');
create type drill_mode    as enum ('quick','focused','weak_spots','lesson','study');
create type entitlement_tier as enum ('free','pro');

-- ============================================================
-- Identity
-- ============================================================

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  -- Load-bearing for streak logic. Never default to UTC silently.
  timezone     text not null default 'UTC',
  onboarding_completed_at timestamptz,
  placement_skill_tag text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles: read own"   on profiles for select using (auth.uid() = id);
create policy "profiles: update own" on profiles for update using (auth.uid() = id);
create policy "profiles: insert own" on profiles for insert with check (auth.uid() = id);

-- ============================================================
-- Content  (authenticated read, service-role write)
-- ============================================================

create table tracks (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  description text,
  sort_order  int  not null default 0,
  published   boolean not null default false
);

create table modules (
  id         uuid primary key default gen_random_uuid(),
  track_id   uuid not null references tracks(id) on delete cascade,
  slug       text not null,
  title      text not null,
  sort_order int  not null default 0,
  unique (track_id, slug)
);

create table lessons (
  id         uuid primary key default gen_random_uuid(),
  module_id  uuid not null references modules(id) on delete cascade,
  slug       text not null,
  title      text not null,
  -- Structured lesson content; validated against a Zod schema in packages/content
  body       jsonb not null,
  skill_tags text[] not null default '{}',
  sort_order int  not null default 0,
  version    text not null default '1',
  unique (module_id, slug)
);

create table range_chart_sets (
  id         uuid primary key default gen_random_uuid(),
  version    text not null unique,
  published  boolean not null default false,
  notes      text,
  created_at timestamptz not null default now()
);

create table range_charts (
  id             uuid primary key default gen_random_uuid(),
  chart_set_id   uuid not null references range_chart_sets(id) on delete cascade,
  table_size     int  not null default 6,
  stack_depth    int  not null default 100,
  hero_position  position_6max not null,
  action_sequence text not null,
  -- 169 canonical hands -> action frequency arrays. Sum to 1.0 per hand.
  ranges         jsonb not null,
  skill_tags     text[] not null default '{}',
  unique (chart_set_id, table_size, stack_depth, hero_position, action_sequence)
);

create table drill_templates (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  -- Position constraints, action sequence, hand-sampling weights
  config      jsonb not null,
  skill_tags  text[] not null default '{}',
  published   boolean not null default false
);

alter table tracks           enable row level security;
alter table modules          enable row level security;
alter table lessons          enable row level security;
alter table range_chart_sets enable row level security;
alter table range_charts     enable row level security;
alter table drill_templates  enable row level security;

-- Read-only to signed-in users. Writes happen via service role only,
-- which bypasses RLS — so we deliberately create no write policies.
create policy "tracks: read"     on tracks           for select to authenticated using (published);
create policy "modules: read"    on modules          for select to authenticated using (true);
create policy "lessons: read"    on lessons          for select to authenticated using (true);
create policy "chartsets: read"  on range_chart_sets for select to authenticated using (published);
create policy "charts: read"     on range_charts     for select to authenticated using (true);
create policy "templates: read"  on drill_templates  for select to authenticated using (published);

-- ============================================================
-- Activity
-- ============================================================

create table drill_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  mode          drill_mode not null,
  config        jsonb not null default '{}',
  spots_planned int,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create table drill_attempts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  session_id    uuid references drill_sessions(id) on delete set null,
  template_id   uuid references drill_templates(id) on delete set null,

  -- Reproducibility: seed + chart_version regenerates this exact spot later
  seed          bigint not null,
  chart_version text not null,
  scenario      jsonb not null,

  user_action   poker_action not null,
  user_size     numeric(6,2),
  primary_action poker_action not null,
  frequencies   jsonb not null,

  grade         grade_tier not null,
  ev_loss       numeric(8,4) not null default 0,
  response_ms   int,

  skill_tags    text[] not null default '{}',
  created_at    timestamptz not null default now()
);

create index on drill_attempts (user_id, created_at desc);
create index on drill_attempts using gin (skill_tags);
create index on drill_sessions (user_id, started_at desc);

alter table drill_sessions enable row level security;
alter table drill_attempts enable row level security;

create policy "sessions: own" on drill_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "attempts: own" on drill_attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Progress
-- ============================================================

create table lesson_progress (
  user_id      uuid not null references auth.users(id) on delete cascade,
  lesson_id    uuid not null references lessons(id) on delete cascade,
  status       lesson_status not null default 'available',
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

-- Denormalized rollup. Weak-spot detection reads this, never aggregates
-- drill_attempts at request time.
create table skill_stats (
  user_id        uuid not null references auth.users(id) on delete cascade,
  skill_tag      text not null,
  attempts       int  not null default 0,
  correct        int  not null default 0,
  ewma_accuracy  numeric(5,4) not null default 0,
  avg_ev_loss    numeric(8,4) not null default 0,
  last_seen_at   timestamptz,
  primary key (user_id, skill_tag)
);

-- v2 spaced repetition. Ships empty; logged from v1 so history exists.
create table review_queue (
  user_id     uuid not null references auth.users(id) on delete cascade,
  skill_tag   text not null,
  due_at      timestamptz not null,
  interval_days numeric(6,2) not null default 1,
  ease        numeric(4,2) not null default 2.5,
  updated_at  timestamptz not null default now(),
  primary key (user_id, skill_tag)
);

alter table lesson_progress enable row level security;
alter table skill_stats     enable row level security;
alter table review_queue    enable row level security;

create policy "lesson_progress: own" on lesson_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "skill_stats: own" on skill_stats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "review_queue: own" on review_queue
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Gamification
-- ============================================================

-- Append-only ledger. Totals are derived, never stored as a counter.
create table xp_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  amount     int  not null,
  reason     text not null,
  ref_id     uuid,
  created_at timestamptz not null default now()
);

create index on xp_events (user_id, created_at desc);

create table streaks (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  current_streak   int  not null default 0,
  longest_streak   int  not null default 0,
  -- date, not timestamptz: streaks are day-granular in the USER's timezone
  last_active_date date,
  updated_at       timestamptz not null default now()
);

create table achievements (
  id          text primary key,
  title       text not null,
  description text not null,
  criteria    jsonb not null
);

create table user_achievements (
  user_id        uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references achievements(id) on delete cascade,
  unlocked_at    timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

alter table xp_events         enable row level security;
alter table streaks           enable row level security;
alter table achievements      enable row level security;
alter table user_achievements enable row level security;

create policy "xp_events: read own"   on xp_events for select using (auth.uid() = user_id);
create policy "xp_events: insert own" on xp_events for insert with check (auth.uid() = user_id);
create policy "streaks: own"          on streaks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "achievements: read"    on achievements for select to authenticated using (true);
create policy "user_achievements: own" on user_achievements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Commerce  (v2 seam — ships empty, unused in v1)
-- ============================================================

create table entitlements (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  tier       entitlement_tier not null default 'free',
  source     text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table entitlements enable row level security;

-- READ ONLY for users. Writes come from an Edge Function using the service
-- role. Never add a user-facing insert/update policy to this table.
create policy "entitlements: read own" on entitlements
  for select using (auth.uid() = user_id);

-- ============================================================
-- Triggers
-- ============================================================

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at        before update on profiles        for each row execute function set_updated_at();
create trigger lesson_progress_updated_at before update on lesson_progress for each row execute function set_updated_at();
create trigger review_queue_updated_at    before update on review_queue    for each row execute function set_updated_at();
create trigger streaks_updated_at         before update on streaks         for each row execute function set_updated_at();
create trigger entitlements_updated_at    before update on entitlements    for each row execute function set_updated_at();

-- Create profile + streak rows on signup
create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.streaks (user_id) values (new.id);
  insert into public.entitlements (user_id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();