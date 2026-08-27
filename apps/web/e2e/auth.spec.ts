import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

/**
 * The Phase 5 exit criterion, automated: "You can sign up, land on an empty
 * dashboard, and sign out."
 *
 * Run against the real local stack as a genuinely new user each time, rather
 * than a stubbed session — the point is that the whole chain works: proxy
 * refresh, cookie handoff to Server Components, the DAL check, and the Phase 4
 * signup trigger underneath.
 */

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;

const PASSWORD = 'correct horse battery staple';

/**
 * A monotonic counter rather than Math.random(): CLAUDE.md bans bare
 * Math.random() repo-wide, and a counter is strictly better here anyway —
 * random can collide, this cannot. Matches scripts/tests/rls.test.ts.
 */
let sequence = 0;

function freshEmail(label: string): string {
  sequence += 1;
  return `e2e-${label}-${Date.now()}-${sequence}-${process.pid}@test.local`;
}

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
}

/**
 * Gets a fresh account past onboarding and onto the dashboard.
 *
 * Phase 8 sends a new account to the placement diagnostic before the dashboard
 * — Phase 5's "sign up, land on the dashboard" is now "sign up, get placed,
 * land on the dashboard". Skipping is one click and leaves the reader at the
 * start of the track.
 */
async function reachDashboard(page: Page): Promise<void> {
  // The sign-up action redirects; navigating before it settles arrives without
  // a session cookie and gets bounced to sign-in.
  await page.waitForURL(/\/(dashboard|onboarding)$/);

  await page.goto('/onboarding');
  if (new URL(page.url()).pathname === '/onboarding') {
    await page.getByRole('button', { name: /Skip, start at the beginning/ }).click();
    await page.waitForSelector('[data-testid="placement-result"]');
  }
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe('the exit criterion', () => {
  test('sign up, get placed, land on the dashboard, sign out', async ({ page }) => {
    const email = freshEmail('happy');

    await signUp(page, email);

    // Phase 8 puts onboarding first. The dashboard is still where you end up.
    await reachDashboard(page);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeAttached();

    // It is the *empty* dashboard: six modes, all inert, and honest zeroes.
    await expect(page.getByRole('listitem')).toHaveCount(6);
    await expect(page.getByText('No weak spots yet — drill 20 hands and check back.')).toBeVisible();
    await expect(page.getByText('0 days')).toBeVisible();

    // The signed-in chrome knows who it is.
    await expect(page.getByText(email)).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('and the session actually ended — going back does not restore it', async ({ page }) => {
    await signUp(page, freshEmail('logout'));
    await reachDashboard(page);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);

    // A signed-out user typing the URL directly must not get in.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe('protected routes', () => {
  test('a signed-out visitor is sent to sign-in, and back afterwards', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard/);

    // Sign in from here and the `next` param should return them.
    const email = freshEmail('return');
    const supabase = createClient(SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    await supabase.auth.signUp({ email, password: PASSWORD });

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // The `next` param returns them to /dashboard; onboarding then intercepts,
    // which is the redirect working rather than the return being lost.
    await expect(page).toHaveURL(/\/(dashboard|onboarding)$/);
  });

  test('the root path routes by session rather than showing a page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});

test.describe('the second line of defense', () => {
  /**
   * Isolates the DAL check from the proxy check.
   *
   * Every other test here is satisfied by `src/proxy.ts` redirecting first, so
   * they would all still pass with `requireUser()` deleted entirely — verified
   * by deliberately breaking it. That is exactly the situation Next's auth
   * guide warns about ("Proxy should not be your only line of defense"), and a
   * suite that cannot tell the difference is giving false confidence about the
   * layer that matters.
   *
   * The wedge: delete the account server-side while its cookie is still live.
   * The access token stays unexpired and well-formed, so a check that only
   * inspects the token lets the request through — while `getUser()` asks the
   * auth server and is told the user is gone.
   */
  test('a live cookie for a deleted account still cannot reach the dashboard', async ({
    page,
  }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY to delete the user');

    const email = freshEmail('revoked');
    await signUp(page, email);
    await reachDashboard(page);

    const admin = createClient(SUPABASE_URL!, SERVICE_KEY!);
    const { data: users } = await admin.auth.admin.listUsers();
    const user = users.users.find((u) => u.email === email);
    expect(user, 'the signed-up user should exist before deletion').toBeDefined();

    await admin.auth.admin.deleteUser(user!.id);

    // The browser still holds a valid, unexpired session cookie.
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe('open redirect', () => {
  /**
   * safeNext() is unit-tested exhaustively; this proves it is actually wired
   * into the flow rather than merely existing. An attacker-supplied `next`
   * must not survive a real sign-in.
   */
  test('a hostile next param cannot bounce a signed-in user off-origin', async ({ page }) => {
    const email = freshEmail('redirect');
    const supabase = createClient(SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    await supabase.auth.signUp({ email, password: PASSWORD });

    await page.goto('/sign-in?next=https%3A%2F%2Fevil.example%2Fharvest');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    expect(new URL(page.url()).host).not.toContain('evil.example');
  });
});

test.describe('the Phase 4 contract', () => {
  /**
   * handle_new_user() reads `timezone` out of raw_user_meta_data, and docs/04
   * calls it load-bearing for streaks while warning against silently
   * defaulting to UTC. The sign-up form is the only thing that ever sends it,
   * so if this regresses nothing else notices until streaks are wrong.
   */
  test('sign-up sends the browser timezone into the profile', async ({ page, context }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY to read the profile back');

    await context.clearCookies();
    // A zone that is definitely not the machine's default and definitely real.
    await page.emulateMedia({});
    await page.addInitScript(() => {
      const original = Intl.DateTimeFormat;
      // @ts-expect-error - deliberately narrowing the browser API for the test
      Intl.DateTimeFormat = function (...args: unknown[]) {
        const instance = new original(...(args as []));
        const resolved = instance.resolvedOptions.bind(instance);
        instance.resolvedOptions = () => ({ ...resolved(), timeZone: 'Australia/Eucla' });
        return instance;
      };
    });

    const email = freshEmail('tz');
    await signUp(page, email);
    // Onboarding or the dashboard — this test is about what the trigger wrote,
    // not about where the browser landed.
    await page.waitForURL(/\/(dashboard|onboarding)$/);

    const admin = createClient(SUPABASE_URL!, SERVICE_KEY!);
    const { data: users } = await admin.auth.admin.listUsers();
    const user = users.users.find((u) => u.email === email);
    expect(user).toBeDefined();

    const { data: profile } = await admin
      .from('profiles')
      .select('timezone')
      .eq('id', user!.id)
      .single();

    expect(profile?.timezone).toBe('Australia/Eucla');
  });
});
