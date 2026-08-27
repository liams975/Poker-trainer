-- CLAUDE.md: "Validate all user input at the DB boundary with constraints,
-- not just in TS."
--
-- Every assertion here writes through the `authenticated` role as the owner
-- of the row, so what is being tested is the constraint and not the policy.
-- The engine already refuses all of these; the point is that the database
-- refuses them too, for a client that skips the engine.

begin;

create extension if not exists pgtap with schema extensions;
-- pgtap lives in `extensions`, which is not on the default search_path for a
-- psql session, so plan()/is()/throws_ok() would not resolve without this.
set local search_path to extensions, public, pg_catalog;

select no_plan();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('eeeeeeee-0000-4000-8000-000000000005',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'erin@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

-- `pnpm content:sync` has already seeded the real vocabulary, so these
-- are no-ops in a seeded database and inserts in an empty one.
insert into skill_tags (tag) values ('preflop.rfi.utg') on conflict (tag) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000005","role":"authenticated"}';

-- ------------------------------------------------------------
-- The skill-tag vocabulary
-- ------------------------------------------------------------

select throws_ok(
  $$ insert into drill_attempts (user_id, seed, chart_version, scenario, user_action,
                                 primary_action, frequencies, grade, skill_tags)
     values (auth.uid(), 1, 'v1', '{}'::jsonb, 'fold', 'fold',
             '[{"action":"fold","freq":1}]'::jsonb, 'optimal',
             array['preflop.rfi.typo']) $$,
  '23514',
  'unknown skill tag(s): preflop.rfi.typo; the vocabulary lives in packages/content/src/skill-tags.ts',
  'an undeclared skill tag is rejected, by name'
);

select lives_ok(
  $$ insert into drill_attempts (user_id, seed, chart_version, scenario, user_action,
                                 primary_action, frequencies, grade, skill_tags)
     values (auth.uid(), 1, 'v1', '{}'::jsonb, 'fold', 'fold',
             '[{"action":"fold","freq":1}]'::jsonb, 'optimal',
             array['preflop.rfi.utg']) $$,
  'a declared skill tag is accepted'
);

select throws_ok(
  $$ insert into skill_stats (user_id, skill_tag) values (auth.uid(), 'not.a.tag') $$,
  '23503', NULL::text,
  'the scalar skill_tag column is a real foreign key'
);

-- ------------------------------------------------------------
-- drill_attempts: the columns a client writes on every single spot
-- ------------------------------------------------------------

select throws_ok(
  $$ insert into drill_attempts (user_id, seed, chart_version, scenario, user_action,
                                 primary_action, frequencies, grade, ev_loss)
     values (auth.uid(), 1, 'v1', '{}'::jsonb, 'fold', 'fold',
             '[{"action":"fold","freq":1}]'::jsonb, 'optimal', -1) $$,
  '23514', NULL::text,
  'ev_loss cannot be negative — it is a loss, never a gain'
);

select throws_ok(
  $$ insert into drill_attempts (user_id, seed, chart_version, scenario, user_action,
                                 primary_action, frequencies, grade)
     values (auth.uid(), 4294967296, 'v1', '{}'::jsonb, 'fold', 'fold',
             '[{"action":"fold","freq":1}]'::jsonb, 'optimal') $$,
  '23514', NULL::text,
  'a seed outside uint32 is rejected: mulberry32 would refuse to replay it'
);

select lives_ok(
  $$ insert into drill_attempts (user_id, seed, chart_version, scenario, user_action,
                                 primary_action, frequencies, grade)
     values (auth.uid(), 4294967295, 'v1', '{}'::jsonb, 'fold', 'fold',
             '[{"action":"fold","freq":1}]'::jsonb, 'optimal') $$,
  'the top of the uint32 range is still a valid seed'
);

select throws_ok(
  $$ insert into drill_attempts (user_id, seed, chart_version, scenario, user_action,
                                 primary_action, frequencies, grade)
     values (auth.uid(), 1, 'v1', '{}'::jsonb, 'raise', 'fold',
             '[{"action":"fold","freq":1}]'::jsonb, 'optimal') $$,
  '23514', NULL::text,
  'a raise with no size is rejected, mirroring the engine SIZED_ACTIONS rule'
);

select throws_ok(
  $$ insert into drill_attempts (user_id, seed, chart_version, scenario, user_action,
                                 user_size, primary_action, frequencies, grade)
     values (auth.uid(), 1, 'v1', '{}'::jsonb, 'fold', 2.5, 'fold',
             '[{"action":"fold","freq":1}]'::jsonb, 'optimal') $$,
  '23514', NULL::text,
  'a fold carrying a size is rejected too — the rule runs both ways'
);

select throws_ok(
  $$ insert into drill_attempts (user_id, seed, chart_version, scenario, user_action,
                                 primary_action, frequencies, grade)
     values (auth.uid(), 1, 'v1', '{}'::jsonb, 'fold', 'fold',
             '[]'::jsonb, 'optimal') $$,
  '23514', NULL::text,
  'an empty frequency distribution is rejected: there is nothing to explain'
);

select throws_ok(
  $$ insert into drill_attempts (user_id, seed, chart_version, scenario, user_action,
                                 primary_action, frequencies, grade)
     values (auth.uid(), 1, 'v1', '"not an object"'::jsonb, 'fold', 'fold',
             '[{"action":"fold","freq":1}]'::jsonb, 'optimal') $$,
  '23514', NULL::text,
  'a scenario that is not a JSON object is rejected'
);

select throws_ok(
  $$ insert into drill_attempts (user_id, seed, chart_version, scenario, user_action,
                                 primary_action, frequencies, grade, response_ms)
     values (auth.uid(), 1, 'v1', '{}'::jsonb, 'fold', 'fold',
             '[{"action":"fold","freq":1}]'::jsonb, 'optimal', -5) $$,
  '23514', NULL::text,
  'a negative response time is rejected'
);

-- ------------------------------------------------------------
-- Sessions, progress, gamification
-- ------------------------------------------------------------

select throws_ok(
  $$ insert into drill_sessions (user_id, mode, started_at, completed_at)
     values (auth.uid(), 'quick', now(), now() - interval '1 hour') $$,
  '23514', NULL::text,
  'a session cannot finish before it started'
);

select throws_ok(
  $$ insert into skill_stats (user_id, skill_tag, attempts, correct)
     values (auth.uid(), 'preflop.rfi.utg', 3, 5) $$,
  '23514', NULL::text,
  'correct answers cannot exceed attempts'
);

select throws_ok(
  $$ insert into skill_stats (user_id, skill_tag, ewma_accuracy)
     values (auth.uid(), 'preflop.rfi.utg', 1.5) $$,
  '23514', NULL::text,
  'an accuracy is a rate in [0, 1]'
);

select throws_ok(
  $$ update streaks set current_streak = 10, longest_streak = 2 where user_id = auth.uid() $$,
  '23514', NULL::text,
  'the longest streak cannot be shorter than the current one'
);

select throws_ok(
  $$ insert into xp_events (user_id, amount, reason) values (auth.uid(), 999999999, 'lol') $$,
  '23514', NULL::text,
  'xp is bounded — honour-system, but not unbounded'
);

-- ------------------------------------------------------------
-- Timezone: load-bearing for streaks, per docs/04
-- ------------------------------------------------------------

select throws_ok(
  $$ update profiles set timezone = 'Mars/Olympus_Mons' where id = auth.uid() $$,
  '23514', NULL::text,
  'a timezone that is not a real IANA zone is rejected'
);

select lives_ok(
  $$ update profiles set timezone = 'America/New_York' where id = auth.uid() $$,
  'a real IANA zone is accepted'
);

-- ------------------------------------------------------------
-- Phase 8: placement is its own drill mode
-- ------------------------------------------------------------

-- Recording a placement diagnostic as `quick` would leave Phase 9 unable to
-- keep it out of accuracy stats, the same way `study` is kept out.
select ok(
  'placement' = any (enum_range(null::drill_mode)::text[]),
  'drill_mode carries a placement value'
);

select lives_ok(
  $$ insert into drill_sessions (user_id, mode) values (auth.uid(), 'placement') $$,
  'a placement session can be recorded'
);

select * from finish();

rollback;
