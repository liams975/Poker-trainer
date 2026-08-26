-- docs/04-data-model.md, "RLS test cases (Phase 4 exit criteria)":
--   1. User A cannot SELECT user B's drill_attempts.
--   2. User A cannot INSERT a drill_attempt with user_id = B.
--   3. User A cannot UPDATE their own entitlements row.
--   6. A user can read and write their own rows in every user-scoped table.
--
-- docs/01-architecture.md ranks RLS gaps as the #1 attack surface for this
-- app and asks that policies be tested "as part of the suite, not by
-- eyeballing them". These are those tests.
--
-- no_plan() rather than a counted plan: these files are linear, and a
-- hand-maintained count is one more thing to get wrong when a case is added.

begin;

create extension if not exists pgtap with schema extensions;
-- pgtap lives in `extensions`, which is not on the default search_path for a
-- psql session, so plan()/is()/throws_ok() would not resolve without this.
set local search_path to extensions, public, pg_catalog;

select no_plan();

-- ------------------------------------------------------------
-- Fixtures. Inserting into auth.users fires on_auth_user_created, so this
-- also exercises the signup trigger rewritten in 0002.
-- ------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
  ('aaaaaaaa-0000-4000-8000-000000000001',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'alice@test.local', 'x', now(), now(), now(), '{}'::jsonb,
   '{"timezone":"Europe/London","display_name":"Alice"}'::jsonb),
  ('bbbbbbbb-0000-4000-8000-000000000002',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bob@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  -- 60 characters, and a timezone no tzdata has ever shipped. Neither is
  -- allowed to cost this person their account.
  ('ffffffff-0000-4000-8000-000000000006',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'long@test.local', 'x', now(), now(), now(), '{}'::jsonb,
   format('{"timezone":"Mars/Olympus_Mons","display_name":"%s"}', repeat('a', 60))::jsonb);

-- `pnpm content:sync` has already seeded the real vocabulary, so these
-- are no-ops in a seeded database and inserts in an empty one.
insert into skill_tags (tag) values ('preflop.rfi.utg') on conflict (tag) do nothing;

-- Bob's private rows, written as Bob so RLS is exercised on the way in.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

insert into drill_attempts (user_id, seed, chart_version, scenario, user_action,
                            primary_action, frequencies, grade, ev_loss, skill_tags)
values ('bbbbbbbb-0000-4000-8000-000000000002', 42, 'v1',
        '{"hand":"AA"}'::jsonb, 'fold', 'raise',
        '[{"action":"raise","freq":1}]'::jsonb, 'blunder', 2.5,
        array['preflop.rfi.utg']);

insert into drill_sessions (user_id, mode) values ('bbbbbbbb-0000-4000-8000-000000000002', 'quick');
insert into xp_events (user_id, amount, reason) values ('bbbbbbbb-0000-4000-8000-000000000002', 10, 'drill');
insert into skill_stats (user_id, skill_tag) values ('bbbbbbbb-0000-4000-8000-000000000002', 'preflop.rfi.utg');

-- ------------------------------------------------------------
-- The signup trigger
-- ------------------------------------------------------------

reset role;

select is(
  (select timezone from profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'Europe/London',
  'signup captures the timezone from user metadata instead of defaulting to UTC'
);

select is(
  (select timezone from profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  'UTC',
  'a signup with no timezone falls back to UTC rather than failing'
);

-- The signup trigger must not be a place where bad metadata is fatal. It runs
-- inside the auth.users insert, so anything it raises rolls the whole signup
-- back and the caller gets an HTTP 500 with no account. Both of these came
-- from a real OAuth-shaped payload: a 60-character name and a junk timezone.
select is(
  (select char_length(display_name) from profiles where id = 'ffffffff-0000-4000-8000-000000000006'),
  50,
  'an over-long display name is truncated at signup, not rejected'
);

select is(
  (select timezone from profiles where id = 'ffffffff-0000-4000-8000-000000000006'),
  'UTC',
  'and a bogus timezone alongside it still falls back rather than failing'
);

select is(
  (select count(*) from entitlements where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1::bigint,
  'signup creates the entitlement row server-side'
);

select is(
  (select tier::text from entitlements where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'free',
  'a new user starts on free, not on a tier the client chose'
);

-- ------------------------------------------------------------
-- Act as Alice for the rest of the file.
-- ------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

select is(auth.uid(), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
          'the JWT claim is what auth.uid() reads');

-- Case 1 — A cannot read B's rows, in every user-scoped table.

select is((select count(*) from drill_attempts where user_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
          0::bigint, 'case 1: A cannot SELECT B''s drill_attempts');

select is((select count(*) from drill_sessions where user_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
          0::bigint, 'A cannot SELECT B''s drill_sessions');

select is((select count(*) from xp_events where user_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
          0::bigint, 'A cannot SELECT B''s xp_events');

select is((select count(*) from skill_stats where user_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
          0::bigint, 'A cannot SELECT B''s skill_stats');

select is((select count(*) from profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
          0::bigint, 'A cannot SELECT B''s profile');

select is((select count(*) from entitlements where user_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
          0::bigint, 'A cannot SELECT B''s entitlements');

select is((select count(*) from streaks where user_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
          0::bigint, 'A cannot SELECT B''s streak');

-- The table is not empty; the filtering is the policy's doing, not luck.
select is((select count(*) from drill_attempts), 0::bigint,
          'an unfiltered SELECT still returns none of B''s rows');

-- Case 2 — A cannot write a row owned by B.

select throws_ok(
  $$ insert into drill_attempts (user_id, seed, chart_version, scenario, user_action,
                                 primary_action, frequencies, grade)
     values ('bbbbbbbb-0000-4000-8000-000000000002', 1, 'v1', '{}'::jsonb,
             'fold', 'fold', '[{"action":"fold","freq":1}]'::jsonb, 'optimal') $$,
  '42501', NULL::text,
  'case 2: A cannot INSERT a drill_attempt with user_id = B'
);

select throws_ok(
  $$ insert into xp_events (user_id, amount, reason)
     values ('bbbbbbbb-0000-4000-8000-000000000002', 999, 'gift') $$,
  '42501', NULL::text,
  'A cannot INSERT xp for B'
);

-- Refused outright, not filtered. drill_attempts carries no UPDATE grant for
-- `authenticated` at all — it is an append-only ledger like xp_events, because
-- skill_stats and review_queue are both derived from it. So this fails at the
-- privilege layer before RLS is ever consulted, which is the stricter of the
-- two mechanisms. The proof it changed nothing is the last assertion here.
select throws_ok(
  $$ update drill_attempts set grade = 'optimal'
     where user_id = 'bbbbbbbb-0000-4000-8000-000000000002' $$,
  '42501', NULL::text,
  'A cannot regrade B''s attempt'
);

select throws_ok(
  $$ update drill_attempts set grade = 'optimal' where user_id = auth.uid() $$,
  '42501', NULL::text,
  'and cannot regrade their own either — a graded attempt is a fact'
);

select throws_ok(
  $$ delete from drill_attempts where user_id = auth.uid() $$,
  '42501', NULL::text,
  'nor delete one: you cannot recompute skill_stats from a log its author can edit'
);

-- Case 3 — entitlements are read-only to the user who owns them.

select throws_ok(
  $$ update entitlements set tier = 'pro' where user_id = auth.uid() $$,
  '42501', NULL::text,
  'case 3: A cannot UPDATE their own entitlements row'
);

select throws_ok(
  $$ insert into entitlements (user_id, tier) values (auth.uid(), 'pro') $$,
  '42501', NULL::text,
  'A cannot INSERT an entitlement row for themselves either'
);

-- The ledger is append-only by privilege, not merely by convention.

select throws_ok(
  $$ update xp_events set amount = 100000 where user_id = auth.uid() $$,
  '42501', NULL::text,
  'xp_events cannot be updated, even by their owner'
);

select throws_ok(
  $$ delete from xp_events where user_id = auth.uid() $$,
  '42501', NULL::text,
  'xp_events cannot be deleted, even by their owner'
);

-- Case 6 — A can read and write their own rows everywhere.

select lives_ok(
  $$ insert into drill_sessions (user_id, mode) values (auth.uid(), 'quick') $$,
  'case 6: A can INSERT their own drill_session'
);

select lives_ok(
  $$ insert into drill_attempts (user_id, seed, chart_version, scenario, user_action,
                                 user_size, primary_action, frequencies, grade, skill_tags)
     values (auth.uid(), 7, 'v1', '{"hand":"KK"}'::jsonb, 'raise', 2.5, 'raise',
             '[{"action":"raise","freq":1}]'::jsonb, 'optimal',
             array['preflop.rfi.utg']) $$,
  'A can INSERT their own drill_attempt'
);

select lives_ok(
  $$ insert into xp_events (user_id, amount, reason) values (auth.uid(), 25, 'drill') $$,
  'A can append to their own xp ledger'
);

-- lesson_progress is deliberately not exercised here: lesson_id is NOT NULL
-- against a lessons table that stays empty until Phase 8, so there is nothing
-- honest to insert. Its policy is identical in shape to skill_stats', which is
-- covered above.

select lives_ok(
  $$ update profiles set display_name = 'Alice B' where id = auth.uid() $$,
  'A can UPDATE their own profile'
);

select lives_ok(
  $$ update streaks set current_streak = 3, longest_streak = 3 where user_id = auth.uid() $$,
  'A can UPDATE their own streak'
);

select is((select count(*) from drill_attempts where user_id = auth.uid()), 1::bigint,
          'A reads back exactly their own attempt, and only it');

select is((select display_name from profiles where id = auth.uid()), 'Alice B',
          'and reads back the profile they just wrote');

-- Back to superuser to see what actually happened to B's row.
reset role;

select is(
  (select grade::text from drill_attempts
   where user_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  'blunder',
  'B''s attempt still carries the grade B earned, so the filtered UPDATE really did nothing'
);

select * from finish();

rollback;
