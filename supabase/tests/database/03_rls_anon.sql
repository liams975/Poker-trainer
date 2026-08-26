-- docs/04-data-model.md, RLS test case 4:
--   "Anonymous (unauthenticated) requests read zero rows from every user
--    table."
--
-- Enumerated rather than sampled. A table added later without a policy is the
-- exact failure this is meant to catch, so the last assertion in this file
-- fails if any table in `public` ever becomes readable by anon — including
-- one that does not exist yet.

begin;

create extension if not exists pgtap with schema extensions;
-- pgtap lives in `extensions`, which is not on the default search_path for a
-- psql session, so plan()/is()/throws_ok() would not resolve without this.
set local search_path to extensions, public, pg_catalog;

select no_plan();

-- ------------------------------------------------------------
-- Real data, owned by a real user, so "zero rows" means the policy worked
-- rather than the table being empty.
-- ------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('dddddddd-0000-4000-8000-000000000004',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'dave@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

-- `pnpm content:sync` has already seeded the real vocabulary, so these
-- are no-ops in a seeded database and inserts in an empty one.
insert into skill_tags (tag) values ('preflop.rfi.utg') on conflict (tag) do nothing;

insert into tracks (id, slug, title, published)
values ('44444444-0000-4000-8000-000000000001', 'live', 'Published', true);

insert into range_chart_sets (id, version, published)
values ('55555555-0000-4000-8000-000000000001', 'live-1', true);

insert into range_charts (chart_set_id, hero_position, action_sequence, ranges, skill_tags)
values ('55555555-0000-4000-8000-000000000001', 'UTG', 'rfi', '{"AA":[]}'::jsonb,
        array['preflop.rfi.utg']);

insert into drill_templates (slug, title, config, published)
values ('live-template', 'Live', '{"spot":"rfi"}'::jsonb, true);

insert into drill_sessions (user_id, mode) values ('dddddddd-0000-4000-8000-000000000004', 'quick');
insert into xp_events (user_id, amount, reason) values ('dddddddd-0000-4000-8000-000000000004', 10, 'drill');
insert into skill_stats (user_id, skill_tag) values ('dddddddd-0000-4000-8000-000000000004', 'preflop.rfi.utg');
insert into drill_attempts (user_id, seed, chart_version, scenario, user_action,
                            primary_action, frequencies, grade, skill_tags)
values ('dddddddd-0000-4000-8000-000000000004', 1, 'v1', '{"hand":"AA"}'::jsonb,
        'fold', 'raise', '[{"action":"raise","freq":1}]'::jsonb, 'blunder',
        array['preflop.rfi.utg']);

-- ------------------------------------------------------------
-- Now be nobody.
-- ------------------------------------------------------------

set local role anon;

select is(auth.uid(), null, 'an anonymous request has no auth.uid()');

-- User-scoped tables: anon has no grant at all, so these throw rather than
-- returning an empty set. Either outcome leaks nothing; throwing is stricter.

select throws_ok($$ select count(*) from profiles $$,        '42501', NULL::text, 'anon cannot read profiles');
select throws_ok($$ select count(*) from drill_attempts $$,  '42501', NULL::text, 'anon cannot read drill_attempts');
select throws_ok($$ select count(*) from drill_sessions $$,  '42501', NULL::text, 'anon cannot read drill_sessions');
select throws_ok($$ select count(*) from lesson_progress $$, '42501', NULL::text, 'anon cannot read lesson_progress');
select throws_ok($$ select count(*) from skill_stats $$,     '42501', NULL::text, 'anon cannot read skill_stats');
select throws_ok($$ select count(*) from review_queue $$,    '42501', NULL::text, 'anon cannot read review_queue');
select throws_ok($$ select count(*) from xp_events $$,       '42501', NULL::text, 'anon cannot read xp_events');
select throws_ok($$ select count(*) from streaks $$,         '42501', NULL::text, 'anon cannot read streaks');
select throws_ok($$ select count(*) from user_achievements $$, '42501', NULL::text, 'anon cannot read user_achievements');
select throws_ok($$ select count(*) from entitlements $$,    '42501', NULL::text, 'anon cannot read entitlements');

-- Content is not anonymous-readable either. The marketing site is static;
-- nothing renders a chart before sign-in.

select throws_ok($$ select count(*) from tracks $$,           '42501', NULL::text, 'anon cannot read tracks');
select throws_ok($$ select count(*) from range_charts $$,     '42501', NULL::text, 'anon cannot read range_charts');
select throws_ok($$ select count(*) from drill_templates $$,  '42501', NULL::text, 'anon cannot read drill_templates');
select throws_ok($$ select count(*) from skill_tags $$,       '42501', NULL::text, 'anon cannot read skill_tags');

-- And cannot write anywhere.

select throws_ok(
  $$ insert into drill_attempts (user_id, seed, chart_version, scenario, user_action,
                                 primary_action, frequencies, grade)
     values ('dddddddd-0000-4000-8000-000000000004', 1, 'v1', '{}'::jsonb,
             'fold', 'fold', '[{"action":"fold","freq":1}]'::jsonb, 'optimal') $$,
  '42501', NULL::text,
  'anon cannot INSERT a drill_attempt for somebody else'
);

select throws_ok(
  $$ insert into entitlements (user_id, tier)
     values ('dddddddd-0000-4000-8000-000000000004', 'pro') $$,
  '42501', NULL::text,
  'anon cannot grant anybody a paid tier'
);

-- ------------------------------------------------------------
-- The catch-all. This is the assertion that survives future migrations: it
-- enumerates public tables from the catalog rather than from a list somebody
-- has to remember to update.
-- ------------------------------------------------------------

reset role;

-- Every privilege type, not just SELECT. The first version of this assertion
-- checked SELECT alone and passed green while anon held TRUNCATE, REFERENCES
-- and TRIGGER on skill_tags — TRUNCATE empties a table without consulting RLS,
-- so "cannot read it" was never the same claim as "cannot destroy it".
select is(
  (select coalesce(string_agg(format('%s (%s)', c.relname, p.priv),
                              ', ' order by c.relname, p.priv), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   cross join unnest(array['select', 'insert', 'update', 'delete',
                           'truncate', 'references', 'trigger', 'maintain']) as p(priv)
   where n.nspname = 'public'
     and c.relkind = 'r'
     and has_table_privilege('anon', c.oid, p.priv)),
  '',
  'anon holds no privilege of any kind on any table in public'
);

-- authenticated is granted select/insert/update/delete deliberately. What it
-- must never hold is the DDL-adjacent set.
select is(
  (select coalesce(string_agg(format('%s (%s)', c.relname, p.priv),
                              ', ' order by c.relname, p.priv), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   cross join unnest(array['truncate', 'references', 'trigger', 'maintain']) as p(priv)
   where n.nspname = 'public'
     and c.relkind = 'r'
     and has_table_privilege('authenticated', c.oid, p.priv)),
  '',
  'authenticated cannot TRUNCATE, REFERENCE or attach a TRIGGER to anything'
);

-- The same claim from the other end: not "the catalog says so" but "the
-- statement is refused". A signed-in user emptying a table they cannot read a
-- row of is the concrete thing being prevented.
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-4000-8000-000000000004","role":"authenticated"}';

select throws_ok(
  $$ truncate public.skill_tags cascade $$,
  '42501', NULL::text,
  'a signed-in user cannot TRUNCATE the skill-tag vocabulary'
);

select throws_ok(
  $$ truncate public.entitlements $$,
  '42501', NULL::text,
  'nor entitlements, which RLS otherwise makes read-only to them'
);

select throws_ok(
  $$ truncate public.xp_events $$,
  '42501', NULL::text,
  'nor the append-only xp ledger'
);

reset role;

select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity),
  '',
  'every table in public has row level security enabled'
);

select * from finish();

rollback;
