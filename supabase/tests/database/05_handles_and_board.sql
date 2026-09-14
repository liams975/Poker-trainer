-- Phase 14: handles and the weekly EV board.
--
-- `0007` opens the schema's **first cross-user read**. Everything before it
-- answers "your own rows only", so the exception needs proving rather than
-- describing — and the properties worth proving are the negative ones. A
-- leaderboard that shows the right six rows is obvious on sight; a leaderboard
-- that quietly includes somebody who never opted in is not.
--
-- What this file holds:
--   1. Opting in is off by default, and cannot be faked by a null handle.
--   2. Handles are unique, lowercase, and shaped.
--   3. `profiles` itself is still "read own" — no policy moved.
--   4. A user who has not opted in never appears on the board.
--   5. The 200-spot minimum is real.
--   6. `anon` cannot call the board at all.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select no_plan();

-- ------------------------------------------------------------
-- Fixtures: three players. Ann opts in, Bo opts in, Cy never does.
-- ------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-0000-4000-8000-000000000001',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ann@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('22222222-0000-4000-8000-000000000002',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bo@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('33333333-0000-4000-8000-000000000003',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cy@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

-- ------------------------------------------------------------
-- 1. Opting in is off by default
-- ------------------------------------------------------------

select is(
  (select bool_or(leaderboard_opted_in) from profiles),
  false,
  'nobody is on the board until they say so'
);

select is(
  (select count(*)::int from profiles where handle is not null),
  0,
  'and nobody has a handle until they choose one'
);

-- ------------------------------------------------------------
-- 2. Handle shape and uniqueness, at the database boundary
-- ------------------------------------------------------------

select throws_ok(
  $$ update profiles set handle = 'Ann' where id = '11111111-0000-4000-8000-000000000001' $$,
  '23514', NULL::text,
  'an uppercase handle is refused — case must never be the only difference between two handles'
);

select throws_ok(
  $$ update profiles set handle = 'ab' where id = '11111111-0000-4000-8000-000000000001' $$,
  '23514', NULL::text,
  'a two-character handle is refused'
);

select throws_ok(
  $$ update profiles set handle = 'gutshot gary' where id = '11111111-0000-4000-8000-000000000001' $$,
  '23514', NULL::text,
  'a handle with a space is refused'
);

-- The one that matters for impersonation: opting in without a handle to print.
select throws_ok(
  $$ update profiles set leaderboard_opted_in = true
     where id = '11111111-0000-4000-8000-000000000001' $$,
  '23514', NULL::text,
  'a profile cannot opt in without a handle'
);

update profiles set handle = 'chipsahoy', leaderboard_opted_in = true
where id = '11111111-0000-4000-8000-000000000001';

update profiles set handle = 'gutshot_gary', leaderboard_opted_in = true
where id = '22222222-0000-4000-8000-000000000002';

-- Cy plays, and plays well, but never opts in.
update profiles set handle = 'nitrogen' where id = '33333333-0000-4000-8000-000000000003';

select throws_ok(
  $$ update profiles set handle = 'chipsahoy' where id = '33333333-0000-4000-8000-000000000003' $$,
  '23505', NULL::text,
  'two players cannot hold the same handle'
);

-- ------------------------------------------------------------
-- Attempts. 200 each for Ann and Cy, 199 for Bo.
-- ------------------------------------------------------------

insert into drill_attempts (user_id, seed, chart_version, scenario, user_action,
                            primary_action, frequencies, grade, ev_loss, skill_tags)
select
  u.id, g, 'v1', '{}'::jsonb, 'fold', 'raise',
  '[{"action":"raise","freq":1}]'::jsonb, 'inaccurate', u.ev,
  array['preflop.rfi.utg']
from (values
  ('11111111-0000-4000-8000-000000000001'::uuid, 0.40::numeric, 200),
  -- Bo is one spot short of qualifying, and would otherwise top the board.
  ('22222222-0000-4000-8000-000000000002'::uuid, 0.10::numeric, 199),
  -- Cy is the best player here by a distance, and has not opted in.
  ('33333333-0000-4000-8000-000000000003'::uuid, 0.01::numeric, 200)
) as u(id, ev, n)
cross join lateral generate_series(1, u.n) as g;

-- ------------------------------------------------------------
-- 3. profiles is still "read own" — 0007 moved no policy
-- ------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from profiles),
  1,
  'a signed-in user still reads exactly one profile row: their own'
);

select is(
  (select count(*)::int from profiles where handle = 'gutshot_gary'),
  0,
  'and cannot read another player''s handle off the table directly'
);

-- ------------------------------------------------------------
-- 4 & 5. The board itself
-- ------------------------------------------------------------

select is(
  (select count(*)::int from weekly_leaderboard()),
  1,
  'only the opted-in player with enough spots appears'
);

-- `limit 1` rather than a bare scalar subquery. Without it, a regression that
-- lets extra players onto the board aborts this file with "more than one row
-- returned by a subquery" and the opt-in assertions below never get to run —
-- so the suite would fail on the least informative line available.
select is(
  (select handle from weekly_leaderboard() order by rank_position limit 1),
  'chipsahoy',
  'and it is the one who opted in'
);

select is(
  (select count(*)::int from weekly_leaderboard() where handle = 'nitrogen'),
  0,
  'the strongest player on the table is absent, because they never opted in'
);

select is(
  (select count(*)::int from weekly_leaderboard() where handle = 'gutshot_gary'),
  0,
  'and 199 spots is not 200 — the minimum is real'
);

select is(
  (select is_you from weekly_leaderboard() where handle = 'chipsahoy'),
  true,
  'your own row is flagged, which is the only identity the board resolves'
);

-- Seen from Bo's session, Ann's row is still Ann's.
set local request.jwt.claims = '{"sub":"22222222-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select is_you from weekly_leaderboard() where handle = 'chipsahoy'),
  false,
  'and is not flagged for anybody else'
);

-- ------------------------------------------------------------
-- 6. anon cannot call it
-- ------------------------------------------------------------

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$ select * from weekly_leaderboard() $$,
  '42501', NULL::text,
  'a signed-out visitor cannot enumerate handles'
);

reset role;

select * from finish();
rollback;
