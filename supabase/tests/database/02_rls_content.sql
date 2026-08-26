-- docs/04-data-model.md, RLS test case 5:
--   "Authenticated users can read content tables but cannot write them."
--
-- Plus the gap 0002 closed: a child content row must not be readable when its
-- parent is unpublished. 0001 gated tracks and range_chart_sets on `published`
-- but left modules, lessons and range_charts on `using (true)`, so staging a
-- chart set still exposed every chart in it.

begin;

create extension if not exists pgtap with schema extensions;
-- pgtap lives in `extensions`, which is not on the default search_path for a
-- psql session, so plan()/is()/throws_ok() would not resolve without this.
set local search_path to extensions, public, pg_catalog;

select no_plan();

-- ------------------------------------------------------------
-- Clear the seeded content first. `pnpm db:reset` runs the content sync, so
-- the real charts and templates are already here and would swamp the absolute
-- counts below. This whole file runs in a transaction that rolls back, so the
-- delete is local to the test and the seeded rows survive it.
-- ------------------------------------------------------------

delete from range_charts;
delete from range_chart_sets;
delete from drill_templates;
delete from lessons;
delete from modules;
delete from tracks;

-- ------------------------------------------------------------
-- Fixtures: one published tree and one unpublished tree.
-- ------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('cccccccc-0000-4000-8000-000000000003',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'carol@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

-- `pnpm content:sync` has already seeded the real vocabulary, so these
-- are no-ops in a seeded database and inserts in an empty one.
insert into skill_tags (tag) values ('preflop.rfi.utg'), ('preflop.rfi.btn') on conflict (tag) do nothing;

insert into tracks (id, slug, title, published) values
  ('11111111-0000-4000-8000-000000000001', 'live', 'Published track', true),
  ('11111111-0000-4000-8000-000000000002', 'draft', 'Unpublished track', false);

insert into modules (id, track_id, slug, title) values
  ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'm1', 'Live module'),
  ('22222222-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000002', 'm2', 'Draft module');

insert into lessons (module_id, slug, title, body, skill_tags) values
  ('22222222-0000-4000-8000-000000000001', 'l1', 'Live lesson', '{"blocks":[]}'::jsonb, array['preflop.rfi.utg']),
  ('22222222-0000-4000-8000-000000000002', 'l2', 'Draft lesson', '{"blocks":[]}'::jsonb, array['preflop.rfi.btn']);

insert into range_chart_sets (id, version, published) values
  ('33333333-0000-4000-8000-000000000001', 'live-1', true),
  ('33333333-0000-4000-8000-000000000002', 'draft-1', false);

insert into range_charts (chart_set_id, hero_position, action_sequence, ranges, skill_tags) values
  ('33333333-0000-4000-8000-000000000001', 'UTG', 'rfi', '{"AA":[]}'::jsonb, array['preflop.rfi.utg']),
  ('33333333-0000-4000-8000-000000000002', 'BTN', 'rfi', '{"AA":[]}'::jsonb, array['preflop.rfi.btn']);

insert into drill_templates (slug, title, config, published) values
  ('live-template', 'Live', '{"spot":"rfi"}'::jsonb, true),
  ('draft-template', 'Draft', '{"spot":"rfi"}'::jsonb, false);

-- ------------------------------------------------------------
-- Read as a signed-in user.
-- ------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}';

select is((select count(*) from tracks), 1::bigint,
          'case 5: an authenticated user reads published tracks only');

select is((select count(*) from range_chart_sets), 1::bigint,
          'and published chart sets only');

select is((select count(*) from drill_templates), 1::bigint,
          'and published drill templates only');

select is((select count(*) from skill_tags
           where tag in ('preflop.rfi.utg', 'preflop.rfi.btn')), 2::bigint,
          'the skill-tag vocabulary is readable — the UI renders tag names');

-- The four assertions 0002 exists for.

select is((select count(*) from modules), 1::bigint,
          'a module under an unpublished track is not readable');

select is((select count(*) from lessons), 1::bigint,
          'a lesson under an unpublished track is not readable');

select is((select count(*) from range_charts), 1::bigint,
          'a chart in an unpublished set is not readable');

select is(
  (select hero_position::text from range_charts),
  'UTG',
  'and the one chart that is readable is the published one, not whichever came first'
);

-- Content is read-only to users. Writes go through the service role.

select throws_ok(
  $$ insert into tracks (slug, title, published) values ('sneaky', 'Mine', true) $$,
  '42501', NULL::text,
  'case 5: an authenticated user cannot INSERT a track'
);

select throws_ok(
  $$ update range_charts set ranges = '{}'::jsonb $$,
  '42501', NULL::text,
  'an authenticated user cannot UPDATE a range chart'
);

select throws_ok(
  $$ update range_chart_sets set published = true $$,
  '42501', NULL::text,
  'an authenticated user cannot publish a chart set for themselves'
);

select throws_ok(
  $$ delete from drill_templates $$,
  '42501', NULL::text,
  'an authenticated user cannot DELETE a drill template'
);

select throws_ok(
  $$ insert into skill_tags (tag) values ('made.up.tag') $$,
  '42501', NULL::text,
  'an authenticated user cannot extend the skill-tag vocabulary'
);

select * from finish();

rollback;
