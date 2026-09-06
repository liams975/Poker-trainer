-- ============================================================
-- Phase 12b: hand histories for bot play
-- ============================================================
--
-- v2's play mode sits a person at a six-handed table against the engine's
-- opponents. This is where those hands are kept.
--
-- **A hand is a seed and a list of actions.** Every source of randomness in
-- this codebase is seeded and injected (CLAUDE.md), so the deal, the board and
-- all five opponents' decisions are reproducible from one number — which means
-- a hand of six players compresses to a seed, the seating, and hero's own
-- actions. Nothing here stores fifty-two cards, and nothing here stores a
-- serialised `HandState`, for the reason `drill_attempts.scenario` does not
-- either: it would bake today's state shape into stored history.
--
-- The review screen that reads these arrives in 12c. They are written now
-- because a hand you did not record is not one you can go back and record.

-- ============================================================
-- Tables
-- ============================================================

-- A sitting at the table. The container; the hands are the facts.
create table bot_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- Stack depth, blinds, opponent profiles: what was true for the whole sitting.
  config       jsonb not null default '{}',
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);

-- 0005 had to retrofit this onto drill_sessions after Phase 9 started computing
-- session aggregates server-side. Doing it up front here costs an index that
-- can never hold a duplicate and buys the same guarantee from the first row.
alter table bot_sessions
  add constraint bot_sessions_id_user_key unique (id, user_id);

create table bot_hands (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  session_id    uuid,

  -- Which hand of the sitting this was. Not a uniqueness constraint: a
  -- retried write must not be able to lock the session out of its own history.
  hand_no       int not null,

  -- Reproducibility. seed + button + stacks + hero's actions regenerates the
  -- whole hand, opponents included.
  seed          bigint not null,
  button        int not null,
  hero_position position_6max not null,
  -- Stacks at the deal, by position. The table carries stacks between hands,
  -- so a hand cannot be replayed from the stack depth alone.
  stacks        jsonb not null,

  -- What happened. Written from the server's own replay, never from the
  -- client's claim — see apps/web/src/lib/bot/record.ts.
  actions       jsonb not null,
  result        jsonb not null,
  hero_net      numeric(8,2) not null,

  -- Interpretation, the way drill_attempts.chart_version is. The opponents are
  -- reproduced by running the heuristic, so a hand replays identically only
  -- against the version that produced it.
  chart_version    text not null,
  heuristic_version text not null,

  created_at    timestamptz not null default now(),

  -- Validated at the boundary, not only in TypeScript (CLAUDE.md).
  constraint bot_hands_hand_no_positive check (hand_no >= 0),
  constraint bot_hands_seed_uint32 check (seed >= 0 and seed <= 4294967295),
  constraint bot_hands_button_seat check (button >= 0 and button < 6),
  constraint bot_hands_actions_is_array check (jsonb_typeof(actions) = 'array'),
  constraint bot_hands_stacks_is_object check (jsonb_typeof(stacks) = 'object'),
  constraint bot_hands_result_is_object check (jsonb_typeof(result) = 'object')
);

-- `set null (session_id)`, and the column list is load-bearing.
--
-- A bare `on delete set null` on a composite key nulls *every* column in the
-- key — here that means `user_id` too, which is `not null`. Deleting a session
-- would then fail with a constraint violation instead of orphaning the hand,
-- and account deletion cascades through `bot_sessions`, so this would break
-- deleting an account rather than anything obscure. The column list form is
-- Postgres 15+; local and deployed are both 17.6.
--
-- The nulls are correct by default: MATCH SIMPLE skips the check entirely when
-- any column of the key is null, so a hand whose session has been deleted keeps
-- its `user_id` and stays exactly as valid as it was.
--
-- And the pair, not just the id: a hand must not be able to name a session it
-- does not own.
alter table bot_hands
  add constraint bot_hands_session_is_own
  foreign key (session_id, user_id)
  references bot_sessions (id, user_id)
  on delete set null (session_id);

create index on bot_hands (user_id, created_at desc);
create index on bot_hands (session_id, hand_no);
create index on bot_sessions (user_id, started_at desc);

-- ============================================================
-- Row level security
-- ============================================================
--
-- Default deny, then own rows only — the same shape every user-data table in
-- 0001 has. `03_rls_anon.sql` asserts that *every* table in public has RLS
-- enabled, so forgetting this line fails the suite rather than shipping.

alter table bot_sessions enable row level security;
alter table bot_hands    enable row level security;

create policy "bot_sessions: own" on bot_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "bot_hands: own" on bot_hands
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Grants
-- ============================================================
--
-- Explicitly, and in the migration that creates the tables (CLAUDE.md).
--
-- Two independent reasons this cannot be skipped. 0002 revoked the default
-- privileges that used to hand `anon` and `authenticated` `Dxtm` on every new
-- table, so these arrive with *nothing* for those roles — a policy that is
-- never consulted because PostgREST cannot reach the table. And 0002's
-- `grant all on all tables ... to service_role` was a snapshot of the tables
-- that existed when it ran, so the service role needs its DML here too.

-- A sitting is opened and later closed, so it needs update. It is not deleted:
-- there is no "unplay these hands".
grant select, insert, update on bot_sessions to authenticated;

-- Append-only, by privilege rather than by trusting a future policy edit to
-- remember — the same argument `drill_attempts` gets in 0002. A hand is a fact
-- once played, and 12c's review recomputes from these rows.
grant select, insert on bot_hands to authenticated;

grant all on bot_sessions, bot_hands to service_role;
