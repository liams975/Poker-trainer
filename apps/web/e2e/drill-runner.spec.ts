import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 7's exit criteria, against the real stack:
 *
 *   1. A full 25-spot session runs start to finish, playable entirely by
 *      keyboard.
 *   2. Attempts persist with `chart_version`.
 *   3. Mixed-strategy spots display the full distribution, not a single "right
 *      answer".
 *
 * The rows are read back with the service role rather than inferred from the
 * UI. A runner that renders a perfect session and writes nothing would pass
 * every screen assertion, and `drill_attempts` is the table docs/04 makes every
 * later progress figure derive from — so what landed in Postgres is the thing
 * actually under test.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = 'correct horse battery staple';

/** Per-worker unique, for the same reason range-explorer.spec.ts is. */
let sequence = 0;

async function signIn(page: Page): Promise<string> {
  sequence += 1;
  const email = `e2e-drill-${Date.now()}-${process.pid}-${sequence}@test.local`;

  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/dashboard$/);

  return email;
}

function admin() {
  return createClient(SUPABASE_URL!, SERVICE_KEY!);
}

async function userIdFor(email: string): Promise<string> {
  const { data } = await admin().auth.admin.listUsers({ perPage: 1000 });
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`no user for ${email}`);
  return user.id;
}

/** Starts a session and waits for the first spot. */
async function startSession(
  page: Page,
  options: { study?: boolean; length?: string } = {},
): Promise<void> {
  await page.goto('/drill/quick');

  if (options.study) await page.getByRole('button', { name: 'Study', exact: true }).click();
  if (options.length) {
    await page.getByRole('button', { name: options.length, exact: true }).click();
  }

  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForSelector('[data-testid="progress"]');
}

/** Answers the current spot with the first offered choice, by keyboard only. */
async function answerByKeyboard(page: Page): Promise<void> {
  await page.keyboard.press('f');
  await page.waitForSelector('[data-testid="grade"]');
}

/**
 * As above, but waits for the attempt to actually reach Postgres.
 *
 * The grade appears from the browser's own pass, so a test that reads the
 * database as soon as it sees a tier is racing the write it is checking. Any
 * test asserting on stored rows uses this instead.
 */
async function answerAndWaitForRecord(page: Page, key = 'f'): Promise<void> {
  const recorded = page.waitForResponse(
    (response) =>
      response.url().includes('/api/drill/attempts') && response.request().method() === 'POST',
  );
  await page.keyboard.press(key);
  await page.waitForSelector('[data-testid="grade"]');
  await recorded;
}

test.describe('a session runs end to end', () => {
  test('plays 25 spots by keyboard alone and records every one', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY to read the attempts back');
    test.setTimeout(180_000);

    const email = await signIn(page);
    await startSession(page, { length: '25 spots' });

    for (let spot = 1; spot <= 25; spot += 1) {
      await expect(page.getByTestId('progress')).toHaveText(`Spot ${spot} of 25`);

      // Fold with `f`, read the feedback, advance with Space. No mouse at all.
      await answerByKeyboard(page);
      await expect(page.getByTestId('distribution')).toBeVisible();
      await page.keyboard.press(' ');
    }

    await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible();

    const userId = await userIdFor(email);
    const { data: attempts } = await admin()
      .from('drill_attempts')
      .select('chart_version, seed, scenario, grade, skill_tags, response_ms, session_id')
      .eq('user_id', userId);

    expect(attempts).toHaveLength(25);

    for (const attempt of attempts!) {
      // Exit criterion 2, and the reason old attempts stay interpretable.
      expect(attempt.chart_version).toBeTruthy();
      expect(attempt.seed).toBeGreaterThanOrEqual(0);
      expect(attempt.session_id).toBeTruthy();
      expect(attempt.skill_tags).toHaveLength(1);
      expect(attempt.response_ms).toBeGreaterThanOrEqual(0);
      expect(['optimal', 'acceptable', 'inaccurate', 'blunder']).toContain(attempt.grade);
    }

    // Every spot distinct, which is `generateSession`'s no-repeat rule holding
    // through the whole stack rather than only in its unit test.
    const keys = attempts!.map((a) => {
      const scenario = a.scenario as Record<string, string>;
      return `${scenario.heroPosition}|${scenario.actionSequence}|${scenario.hand}`;
    });
    expect(new Set(keys).size).toBe(25);
  });

  test('closes the session row when it finishes', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');

    const email = await signIn(page);
    await startSession(page, { length: '10 spots' });

    for (let spot = 0; spot < 10; spot += 1) {
      await answerByKeyboard(page);
      await page.keyboard.press(' ');
    }

    await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible();

    const userId = await userIdFor(email);
    const { data } = await admin()
      .from('drill_sessions')
      .select('mode, spots_planned, config, completed_at')
      .eq('user_id', userId)
      .single();

    expect(data!.mode).toBe('quick');
    expect(data!.spots_planned).toBe(10);
    expect(data!.completed_at).not.toBeNull();
    // The seed is stored so the whole session can be replayed.
    expect((data!.config as { seed: number }).seed).toBeGreaterThanOrEqual(0);
  });
});

test.describe('the feedback moment', () => {
  test('shows the whole distribution, never one right answer', async ({ page }) => {
    await signIn(page);
    await startSession(page, { length: '10 spots' });

    // Walk spots until one is genuinely mixed. The sampler weights towards
    // mixed hands, so this lands quickly; pure spots are still valid drills.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await answerByKeyboard(page);

      const mix = await page.getByTestId('distribution').getAttribute('data-mix');
      const entries = mix!.split(':')[1]!.split(',');

      if (entries.length > 1) {
        // Every action in the mix is rendered as its own row, with a percentage
        // — not collapsed to the highest-frequency one.
        const rows = page.getByTestId('distribution').locator('li');
        await expect(rows).toHaveCount(entries.length);
        for (const entry of entries) {
          await expect(page.getByTestId('distribution')).toContainText(entry.trim().split(' ')[0]!);
        }
        return;
      }

      await page.keyboard.press(' ');
    }
  });

  test('marks what the user chose without calling it wrong', async ({ page }) => {
    await signIn(page);
    await startSession(page, { length: '10 spots' });
    await answerByKeyboard(page);

    const panel = page.getByTestId('grade');
    await expect(panel).toBeVisible();

    const text = (await panel.textContent())!.toLowerCase();
    expect(text).not.toMatch(/wrong|incorrect|mistake/);
    // Always a frequency: the mix is the lesson.
    expect(text).toMatch(/\d+%|<1%/);
  });

  test('keeps the spot on screen beside the feedback, never a modal', async ({ page }) => {
    await signIn(page);
    await startSession(page, { length: '10 spots' });

    const holeCards = page.getByRole('img', { name: /Your hand:/ });
    await expect(holeCards).toBeVisible();

    await answerByKeyboard(page);

    // docs/05's first desktop advantage: the decision and the chart together.
    await expect(holeCards).toBeVisible();
    await expect(page.getByRole('grid')).toBeVisible();
  });
});

test.describe('the stored grade is the server’s', () => {
  /**
   * The security property. The browser grades for speed, but `recordAttempt`
   * re-derives the spot and grades it again — so a tampered client cannot
   * manufacture a history that `skill_stats` and every later progress figure
   * would then faithfully reproduce.
   *
   * Proven by posting a deliberately false `clientTier` straight at the Server
   * Action's own contract and checking what landed in Postgres.
   */
  test('stores its own grade when the client posts a false one', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY to read the attempt back');

    const email = await signIn(page);
    await startSession(page, { length: '10 spots' });
    await answerAndWaitForRecord(page);

    const userId = await userIdFor(email);
    const { data: honest } = await admin()
      .from('drill_attempts')
      .select('id, session_id, template_id, seed, scenario, user_action, grade')
      .eq('user_id', userId)
      .single();

    // A tier the server cannot possibly agree with, on the very same spot the
    // honest client just answered. `drill_attempts` is append-only, so this
    // lands as a second row rather than amending the first.
    const forged = honest!.grade === 'optimal' ? 'blunder' : 'optimal';

    const response = await page.request.post('/api/drill/attempts', {
      data: {
        sessionId: honest!.session_id,
        templateId: honest!.template_id,
        scenario: honest!.scenario,
        seed: honest!.seed,
        action: honest!.user_action,
        responseMs: 1234,
        clientTier: forged,
      },
    });
    expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);

    const { data: rows } = await admin()
      .from('drill_attempts')
      .select('id, grade')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    expect(rows).toHaveLength(2);

    // Same spot, same action, so the same grade — regardless of what the
    // client claimed. If the server ever trusted `clientTier`, this reads
    // `forged`.
    expect(rows![1]!.grade).toBe(honest!.grade);
    expect(rows![1]!.grade).not.toBe(forged);
  });

  test('grades every stored attempt consistently with its stored distribution', async ({
    page,
  }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY to read the attempts back');

    const email = await signIn(page);
    await startSession(page, { length: '10 spots' });

    for (let spot = 0; spot < 10; spot += 1) {
      await answerByKeyboard(page);
      await page.keyboard.press(' ');
    }

    const userId = await userIdFor(email);
    const { data } = await admin()
      .from('drill_attempts')
      .select('grade, user_action, frequencies')
      .eq('user_id', userId);

    for (const attempt of data!) {
      expect(attempt.user_action).toBe('fold');

      const freqs = attempt.frequencies as { action: string; freq: number }[];
      const foldFreq = freqs
        .filter((f) => f.action === 'fold')
        .reduce((sum, f) => sum + f.freq, 0);
      const best = Math.max(...freqs.map((f) => f.freq));

      // The four tiers from docs/03, recomputed here rather than trusted.
      if (foldFreq === 0) expect(attempt.grade).toBe('blunder');
      else if (foldFreq >= best - 1e-6) expect(attempt.grade).toBe('optimal');
      else if (foldFreq >= 0.15) expect(attempt.grade).toBe('acceptable');
      else expect(attempt.grade).toBe('inaccurate');
    }
  });
});

test.describe('study mode', () => {
  test('shows the chart before the answer, and drill mode does not', async ({ page }) => {
    await signIn(page);
    await startSession(page, { study: true, length: '10 spots' });

    // The pedagogy difference docs/05 defines: chart visible up front.
    await expect(page.getByRole('grid')).toBeVisible();
    await expect(page.getByTestId('grade')).toHaveCount(0);
  });

  test('hides the chart until answered in drill mode', async ({ page }) => {
    await signIn(page);
    await startSession(page, { length: '10 spots' });

    await expect(page.getByRole('grid')).toHaveCount(0);
    await answerByKeyboard(page);
    await expect(page.getByRole('grid')).toBeVisible();
  });

  test('records study sessions under the study mode', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY');

    const email = await signIn(page);
    await startSession(page, { study: true, length: '10 spots' });
    await answerAndWaitForRecord(page);

    const userId = await userIdFor(email);
    const { data } = await admin()
      .from('drill_sessions')
      .select('mode')
      .eq('user_id', userId)
      .single();

    // Recorded, but distinguishable — which is how Phase 9 keeps study out of
    // accuracy stats without losing the history.
    expect(data!.mode).toBe('study');
  });
});

test.describe('keyboard', () => {
  test('opens and closes the shortcuts overlay', async ({ page }) => {
    await signIn(page);
    await startSession(page, { length: '10 spots' });

    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('picks the second raise size with the number key, not the first', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SUPABASE_SERVICE_ROLE_KEY to read the size back');

    const email = await signIn(page);
    await startSession(page, { length: '10 spots' });

    const sized = page.locator('[data-testid^="choice-raise-"]');
    await expect(sized).not.toHaveCount(0);
    const count = await sized.count();
    test.skip(count < 2, 'this spot offers only one raise size');

    const first = Number((await sized.nth(0).getAttribute('data-testid'))!.split('-').at(-1));
    const second = Number((await sized.nth(1).getAttribute('data-testid'))!.split('-').at(-1));
    expect(second).not.toBe(first);

    await answerAndWaitForRecord(page, '2');

    /**
     * Read from `user_size`, because that is the only place the *chosen* size
     * survives: the distribution shows the chart's sizing, which is a different
     * number whenever the user picks the other one. Asserting on the panel
     * would pass even if every number key selected the first option.
     */
    const userId = await userIdFor(email);
    const { data } = await admin()
      .from('drill_attempts')
      .select('user_action, user_size')
      .eq('user_id', userId)
      .single();

    expect(data!.user_action).toBe('raise');
    expect(Number(data!.user_size)).toBe(second);
  });

  test('does not act on a keystroke while the overlay is open', async ({ page }) => {
    await signIn(page);
    await startSession(page, { length: '10 spots' });

    await page.keyboard.press('?');
    await page.keyboard.press('f');

    // Still unanswered: the overlay swallows the shortcut rather than grading
    // a spot the user cannot currently see.
    await expect(page.getByTestId('grade')).toHaveCount(0);
  });
});
