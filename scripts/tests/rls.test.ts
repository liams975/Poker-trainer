/**
 * RLS through the path the app actually uses.
 *
 * The pgTAP suite in supabase/tests/database proves the policies are right at
 * the database boundary. This proves the same thing one layer up, through
 * PostgREST and a real JWT, as two genuinely signed-up users — which is the
 * roadmap's Phase 4 exit criterion verbatim: "signing in as user B returns
 * zero rows from user A's tables."
 *
 * Needs a running stack. `pnpm db:reset` first; `pnpm test` does not run this.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  SKILL_TAGS,
  loadChartSet,
  loadDrillTemplates,
  loadTracks,
} from '@poker/content';
import { orderedLessons } from '@poker/engine';

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error(
    'SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set. ' +
      'Run `supabase status -o env` and export what it prints.',
  );
}

/**
 * Used to sign users up. NOT anonymous after the first signUp: supabase-js
 * keeps the returned session in memory on the client instance, so every later
 * request from it is authenticated as whoever signed up last. That is exactly
 * the trap `guest` below exists to avoid.
 */
const signup = createClient(URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * A genuinely anonymous client. Never calls an auth method, so it never
 * acquires a session and always speaks to PostgREST as the `anon` role.
 */
const guest = createClient(URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const service = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface TestUser {
  id: string;
  email: string;
  db: SupabaseClient;
}

/** Signs up a fresh user and returns a client that speaks as them. */
async function signUpUser(label: string): Promise<TestUser> {
  const email = `rls-${label}-${Date.now()}-${Math.floor(performance.now() * 1000)}@test.local`;
  const password = 'correct horse battery staple';

  const { data, error } = await signup.auth.signUp({
    email,
    password,
    options: { data: { timezone: 'Europe/London', display_name: label } },
  });

  if (error) throw new Error(`signUp(${label}): ${error.message}`);
  if (!data.session || !data.user) {
    throw new Error(
      `signUp(${label}) returned no session. Is auth.email.enable_confirmations false in config.toml?`,
    );
  }

  return {
    id: data.user.id,
    email,
    db: createClient(URL!, ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    }),
  };
}

const attempt = (userId: string) => ({
  user_id: userId,
  seed: 12345,
  chart_version: 'test',
  scenario: { hand: 'AA', heroPosition: 'UTG' },
  user_action: 'fold' as const,
  primary_action: 'raise' as const,
  frequencies: [{ action: 'raise', size: 2.5, freq: 1 }],
  grade: 'blunder' as const,
  ev_loss: 2.5,
});

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  [alice, bob] = await Promise.all([signUpUser('alice'), signUpUser('bob')]);

  const { error } = await alice.db.from('drill_attempts').insert(attempt(alice.id));
  if (error) throw new Error(`seeding Alice's attempt: ${error.message}`);
}, 30_000);

afterAll(async () => {
  await Promise.all(
    [alice, bob].filter(Boolean).map((u) => service.auth.admin.deleteUser(u.id)),
  );
});

describe('a user sees only their own rows', () => {
  it('Alice reads back the attempt she wrote', async () => {
    const { data, error } = await alice.db.from('drill_attempts').select('seed');

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.seed).toBe(12345);
  });

  it('Bob gets zero rows from the same table — the exit criterion', async () => {
    const { data, error } = await bob.db.from('drill_attempts').select('*');

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('Bob cannot reach Alice by filtering for her explicitly', async () => {
    const { data } = await bob.db.from('drill_attempts').select('*').eq('user_id', alice.id);

    expect(data).toEqual([]);
  });

  it.each(['profiles', 'drill_sessions', 'xp_events', 'skill_stats', 'streaks', 'entitlements'])(
    'Bob gets zero rows from %s',
    async (table) => {
      const column = table === 'profiles' ? 'id' : 'user_id';
      const { data } = await bob.db.from(table).select('*').eq(column, alice.id);

      expect(data).toEqual([]);
    },
  );

  it('Bob sees his own profile, so the filter is ownership and not a blanket deny', async () => {
    const { data, error } = await bob.db.from('profiles').select('id, timezone');

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(bob.id);
  });

  it('captures the timezone the client sent at signup', async () => {
    const { data } = await bob.db.from('profiles').select('timezone').single();

    expect(data?.timezone).toBe('Europe/London');
  });
});

describe('a user cannot write rows they do not own', () => {
  it('Bob cannot insert an attempt attributed to Alice', async () => {
    const { error } = await bob.db.from('drill_attempts').insert(attempt(alice.id));

    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('Bob cannot update Alice’s attempt', async () => {
    const { error } = await bob.db
      .from('drill_attempts')
      .update({ grade: 'optimal' })
      .eq('user_id', alice.id)
      .select();

    // Refused at the privilege layer: drill_attempts is append-only, so
    // nobody holds UPDATE on it, Alice included.
    expect(error?.code).toBe('42501');

    const { data: after } = await alice.db.from('drill_attempts').select('grade');
    expect(after?.[0]?.grade).toBe('blunder');
  });

  it('and neither can Alice, whose attempt it is', async () => {
    const { error } = await alice.db
      .from('drill_attempts')
      .update({ grade: 'optimal' })
      .eq('user_id', alice.id);

    expect(error?.code).toBe('42501');
  });

  it('Bob cannot delete Alice’s attempt', async () => {
    const { error } = await bob.db.from('drill_attempts').delete().eq('user_id', alice.id);

    expect(error?.code).toBe('42501');

    const { data } = await alice.db.from('drill_attempts').select('id');
    expect(data).toHaveLength(1);
  });
});

describe('entitlements are server-written only', () => {
  it('a user can read their own entitlement', async () => {
    const { data, error } = await alice.db.from('entitlements').select('tier').single();

    expect(error).toBeNull();
    expect(data?.tier).toBe('free');
  });

  it('a user cannot promote themselves to pro', async () => {
    const { error } = await alice.db
      .from('entitlements')
      .update({ tier: 'pro' })
      .eq('user_id', alice.id);

    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('and cannot insert an entitlement row either', async () => {
    const { error } = await alice.db
      .from('entitlements')
      .insert({ user_id: alice.id, tier: 'pro' });

    // The code matters, not just that it failed. Alice already has an
    // entitlement row from the signup trigger, so an insert with entitlements
    // wide open would still fail — on 23505, duplicate key. Asserting only
    // `error !== null` passes either way and proves nothing.
    expect(error?.code).toBe('42501');
  });
});

describe('anonymous requests', () => {
  it('really are anonymous', async () => {
    // Guards the whole block below. If this client ever picked up a session,
    // every assertion under it would pass while testing nothing.
    const { data } = await guest.auth.getSession();

    expect(data.session).toBeNull();
  });

  it.each([
    'profiles',
    'drill_attempts',
    'drill_sessions',
    'xp_events',
    'streaks',
    'entitlements',
    'range_charts',
    'drill_templates',
  ])('read nothing from %s', async (table) => {
    const { data, error } = await guest.from(table).select('*');

    // Either a hard permission error or an empty set. Both leak nothing;
    // what must never happen is rows coming back.
    expect(data ?? []).toEqual([]);
    if (error) expect(error.code).toBe('42501');
  });
});

describe('content is readable and seeded', () => {
  /**
   * Exit criterion: "pnpm db:reset rebuilds from scratch and seeds content."
   *
   * Counts are derived from `packages/content` rather than written as literals.
   * The literal version broke the moment Phase 8 added the `concept.*` tags —
   * which is a content change, not a regression, and a test that fails for that
   * is a test that will be edited to whatever number makes it pass.
   */
  it.each([
    ['skill_tags', SKILL_TAGS.length],
    ['range_chart_sets', 1],
    ['range_charts', loadChartSet().charts.length],
    ['drill_templates', loadDrillTemplates().length],
    ['tracks', loadTracks().length],
    ['lessons', loadTracks().reduce((n, t) => n + orderedLessons(t).length, 0)],
  ])('%s has %i rows after a sync', async (table, expected) => {
    const { count, error } = await alice.db
      .from(table as string)
      .select('*', { count: 'exact', head: true });

    expect(error).toBeNull();
    expect(count).toBe(expected);
  });

  it('a signed-in user cannot write content', async () => {
    const { error } = await alice.db
      .from('drill_templates')
      .insert({ slug: 'mine', title: 'Mine', config: {}, published: true });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });
});
