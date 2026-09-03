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

-- ------------------------------------------------------------
-- Phase 9: the progress ledger has to add up
-- ------------------------------------------------------------

-- The load-bearing one. XP is awarded when a session closes, through a PATCH a
-- browser can retry — and because every total is derived by summing this
-- table, a duplicated award would be reported faithfully by every screen with
-- nothing left to notice it by.
select lives_ok(
  $$ insert into xp_events (user_id, amount, reason, ref_id)
     values (auth.uid(), 120, 'drill_session',
             '11111111-0000-4000-8000-000000000001') $$,
  'a session can be paid for once'
);

select throws_ok(
  $$ insert into xp_events (user_id, amount, reason, ref_id)
     values (auth.uid(), 120, 'drill_session',
             '11111111-0000-4000-8000-000000000001') $$,
  '23505', NULL::text,
  'the same session cannot be paid for twice'
);

-- Same session id, different reason: a lesson drill that also completed a
-- lesson is two awards, not a duplicate.
select lives_ok(
  $$ insert into xp_events (user_id, amount, reason, ref_id)
     values (auth.uid(), 50, 'lesson_complete',
             '11111111-0000-4000-8000-000000000001') $$,
  'the index keys on the reason as well as the reference'
);

-- The index is partial, so the one award with nothing to key on — the daily
-- goal — is not accidentally limited to one per user for all time.
select lives_ok(
  $$ insert into xp_events (user_id, amount, reason) values (auth.uid(), 25, 'daily_goal'),
                                                            (auth.uid(), 25, 'daily_goal') $$,
  'an award with no reference is not constrained to one row'
);

-- A typo in a reason ships a second, parallel ledger nobody is summing.
select throws_ok(
  $$ insert into xp_events (user_id, amount, reason)
     values (auth.uid(), 10, 'drill_sesion') $$,
  '23514', NULL::text,
  'the xp reason vocabulary is closed'
);

-- An achievement whose criteria the engine cannot evaluate never unlocks for
-- anybody, with no error and nothing on any page to notice.
--
-- Written as the service role, because `achievements` is a content table and
-- `authenticated` holds select on it and nothing else — this is the constraint
-- under test, not the grant, and the grant is 02_rls_content.sql's job.
set local role service_role;

select throws_ok(
  $$ insert into achievements (id, title, description, criteria)
     values ('ghost', 'Ghost', 'Never unlocks.',
             '{"kind":"hands_played","count":10}'::jsonb) $$,
  '23514', NULL::text,
  'an achievement criteria kind the evaluator does not implement is rejected'
);

select throws_ok(
  $$ insert into achievements (id, title, description, criteria)
     values ('ghost', 'Ghost', 'Never unlocks.', '"spots"'::jsonb) $$,
  '23514', NULL::text,
  'criteria must be an object'
);

select lives_ok(
  $$ insert into achievements (id, title, description, criteria)
     values ('real', 'Real', 'Unlocks.', '{"kind":"spots","count":10}'::jsonb) $$,
  'a criteria the evaluator understands is accepted'
);

set local role authenticated;

-- skill_stats is rewritten from drill_attempts on every session close, so the
-- rollup is only as trustworthy as the bounds on what can be written into it.
select throws_ok(
  $$ insert into skill_stats (user_id, skill_tag, attempts, correct, ewma_accuracy)
     values (auth.uid(), 'preflop.rfi.utg', 5, 5, 1.5) $$,
  '23514', NULL::text,
  'ewma accuracy is a rate, not a percentage'
);

select throws_ok(
  $$ insert into skill_stats (user_id, skill_tag, attempts, correct)
     values (auth.uid(), 'preflop.rfi.utg', 3, 9) $$,
  '23514', NULL::text,
  'a rollup cannot claim more correct answers than attempts'
);

-- ------------------------------------------------------------
-- Phase 10: an attempt cannot name a session it does not own
-- ------------------------------------------------------------

-- docs/05-ui-ux.md carried this as "worth a constraint if session aggregates
-- ever get computed server-side". Phase 9's `awardSessionRewards` reads
-- attempts by session id and pays XP from them, so the condition was met.
select lives_ok(
  $$ insert into drill_sessions (id, user_id, mode)
     values ('cccccccc-0000-4000-8000-00000000000c', auth.uid(), 'quick') $$,
  'a user can open their own session'
);

select lives_ok(
  $$ insert into drill_attempts (user_id, session_id, seed, chart_version, scenario,
                                 user_action, primary_action, frequencies, grade)
     values (auth.uid(), 'cccccccc-0000-4000-8000-00000000000c', 1, 'phase10', '{}',
             'fold', 'fold', '[{"action":"fold","freq":1}]'::jsonb, 'optimal') $$,
  'and attach an attempt to it'
);

-- A session that *exists* and belongs to somebody else.
--
-- This distinction is the whole test. A session id that exists nowhere is
-- rejected by the plain `session_id references drill_sessions(id)` that 0001
-- already had, so an assertion using one would pass with 0005 reverted and
-- prove nothing. Only a real session owned by another user separates the two.
-- Back to the connecting role: `auth.users` is not writable by `service_role`,
-- which is why the fixtures at the top of this file run before the role switch.
reset role;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('dddddddd-0000-4000-8000-0000000000dd',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'frank@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

insert into drill_sessions (id, user_id, mode)
values ('dddddddd-0000-4000-8000-00000000000d',
        'dddddddd-0000-4000-8000-0000000000dd', 'quick');

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000005","role":"authenticated"}';

select throws_ok(
  $$ insert into drill_attempts (user_id, session_id, seed, chart_version, scenario,
                                 user_action, primary_action, frequencies, grade)
     values (auth.uid(), 'dddddddd-0000-4000-8000-00000000000d', 1, 'phase10', '{}',
             'fold', 'fold', '[{"action":"fold","freq":1}]'::jsonb, 'optimal') $$,
  '23503', NULL::text,
  'an attempt cannot name a session that exists but is not the author''s own'
);

-- `on delete set null (session_id)` — the column list matters. A bare
-- `set null` on a composite key nulls `user_id` too, which is `not null`, so
-- deleting a session would fail outright and account deletion (which cascades
-- through drill_sessions) would fail with it.
select lives_ok(
  $$ delete from drill_sessions where id = 'cccccccc-0000-4000-8000-00000000000c' $$,
  'deleting a session does not fail on the composite key'
);

select is(
  (select count(*)::int from drill_attempts
   where user_id = auth.uid() and session_id is null and chart_version = 'phase10'),
  1,
  'the attempt outlives its session, keeping its owner'
);

select * from finish();

rollback;
