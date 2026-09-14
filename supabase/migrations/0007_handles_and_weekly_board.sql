-- ============================================================
-- Phase 14: pseudonymous handles and the weekly EV board
-- ============================================================
--
-- The v2 deck's mastery screen (2g) carries a weekly leaderboard: six rows of
-- handle, EV lost per spot and spot count, with your own row highlighted.
--
-- **This is the first cross-user read in the schema.** Every table before it
-- answers "your own rows only", and CLAUDE.md states that as a rule rather than
-- a default. A leaderboard cannot honour it literally, so the exception is
-- built deliberately and made as narrow as it can be:
--
--   1. Participation is **opt-in and off by default**. A user who never opts in
--      is absent from the board and unreadable through it, forever.
--   2. Identity on the board is a **handle the user chooses**, never a
--      display_name, never an email, never a user id.
--   3. The board is reachable **only through the function below**. No policy on
--      `profiles` changes, so "read own" stays literally true of the table.
--   4. The function returns **aggregates**. There is no row shape here that
--      exposes one person's individual attempt to another.
--
-- The narrow thing this does expose: an opted-in user's handle, their EV lost
-- per spot this week, and how many spots they played. That is the product
-- feature, and it is the whole of it.

-- ============================================================
-- Handles
-- ============================================================

alter table profiles
  add column handle text,
  -- Off by default. The column is the consent record; there is no other.
  add column leaderboard_opted_in boolean not null default false;

-- Shape is constrained at the database boundary, not only in TypeScript
-- (CLAUDE.md: "Validate all user input at the DB boundary with constraints").
-- Lowercase so that case can never be the only difference between two handles,
-- which is how impersonation starts.
alter table profiles
  add constraint profiles_handle_format
  check (handle is null or handle ~ '^[a-z0-9_]{3,20}$');

-- Unique, and unique *case-insensitively* by construction since the check above
-- already forbids uppercase. A plain unique index is therefore sufficient and
-- avoids taking a dependency on citext for one column.
create unique index profiles_handle_key on profiles (handle) where handle is not null;

-- A board row with no handle to print is not a row. Enforced rather than
-- filtered, so the function below cannot be the only thing standing between an
-- opted-in null handle and a blank line on someone's screen.
alter table profiles
  add constraint profiles_opted_in_needs_handle
  check (not leaderboard_opted_in or handle is not null);

-- ============================================================
-- The board
-- ============================================================

-- Monday, UTC. The deck says "resets Monday"; date_trunc('week') is ISO and
-- therefore Monday-based already.
--
-- Deliberately **not** per-user timezone, unlike streaks. A streak is a private
-- statement about one person's days and must use their clock. A leaderboard is
-- a comparison, and comparing people on different week boundaries would let a
-- row sit in two weeks at once.
create or replace function public.weekly_board_start()
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select date_trunc('week', (now() at time zone 'utc'))::timestamptz;
$$;

-- Minimum graded spots before a row appears. Mirrors RANK_MIN_SPOTS in
-- packages/engine/src/progress/rank.ts — the deck: "200-spot minimum, so a
-- four-hand hot streak cannot top it."
--
-- security definer, because the whole point is to read rows the caller's own
-- policies forbid. search_path is pinned empty and every reference is
-- schema-qualified: an unpinned definer function is a privilege-escalation
-- vector, not a style nit (CLAUDE.md).
create or replace function public.weekly_leaderboard(row_limit int default 10)
returns table (
  -- `position` is reserved in Postgres (the position(x in y) function), so
  -- the column is named rather than quoted.
  rank_position  bigint,
  handle         text,
  ev_loss_per_spot numeric,
  spots          bigint,
  is_you         boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with scored as (
    select
      a.user_id,
      avg(a.ev_loss)::numeric(8,4) as ev_loss_per_spot,
      count(*)                     as spots
    from public.drill_attempts a
    where a.created_at >= public.weekly_board_start()
    group by a.user_id
    having count(*) >= 200
  )
  select
    rank() over (order by s.ev_loss_per_spot asc) as rank_position,
    p.handle,
    s.ev_loss_per_spot,
    s.spots,
    s.user_id = (select auth.uid()) as is_you
  from scored s
  -- An inner join is the access control. A profile that has not opted in has no
  -- row here at all, so there is no filter to forget and no ordering that can
  -- leak one.
  join public.profiles p
    on p.id = s.user_id
   and p.leaderboard_opted_in
   and p.handle is not null
  order by s.ev_loss_per_spot asc
  limit least(greatest(row_limit, 1), 100);
$$;

-- ============================================================
-- Grants
-- ============================================================
--
-- Grants and RLS are independent layers (CLAUDE.md), and a security definer
-- function is only as safe as the list of who may call it. EXECUTE is granted
-- to the world by default on new functions, so it is revoked first and then
-- given back to exactly one role.
revoke execute on function public.weekly_leaderboard(int) from public;
revoke execute on function public.weekly_board_start() from public;

grant execute on function public.weekly_leaderboard(int) to authenticated;
grant execute on function public.weekly_board_start() to authenticated;

-- anon is deliberately absent from both. A signed-out visitor has no row to be
-- highlighted and no reason to enumerate handles.

grant execute on function public.weekly_leaderboard(int) to service_role;
grant execute on function public.weekly_board_start() to service_role;
