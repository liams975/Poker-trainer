import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * A source-level guard on the review queries.
 *
 * Reading the file rather than calling the functions, because what is being
 * checked is a *property of how they are written*, and the codebase already
 * does this where the same argument applies (`packages/engine/tests/purity`).
 *
 * The property: no query in Session Review names a user id. RLS scopes every
 * one of them, and it has since Phase 4. Adding `.eq('user_id', …)` would look
 * like defence in depth and would in fact be the opposite — it would make every
 * test of one-user-cannot-see-another's-history pass with the policy dropped,
 * so the suite would go on being green while the only real boundary was gone.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL('../src/lib/review/queries.ts', import.meta.url)),
  'utf8',
);

describe('lib/review/queries.ts', () => {
  it('never filters on a user id', () => {
    // `.eq('user_id', …)`, `.match({ user_id })`, `user_id:` in a filter — any
    // spelling of "scope this myself" is the thing being excluded.
    expect(SOURCE).not.toMatch(/\.eq\(\s*['"]user_id['"]/);
    expect(SOURCE).not.toMatch(/\.match\(\s*\{[^}]*user_id/);
    expect(SOURCE).not.toMatch(/\.filter\(\s*['"]user_id['"]/);
  });

  it('never inserts, updates or deletes', () => {
    // Review is a read surface. `drill_attempts` is append-only by grant, and a
    // write from here would be a write nothing else in the app knows about.
    for (const verb of ['.insert(', '.update(', '.upsert(', '.delete(']) {
      expect(SOURCE, `queries.ts calls ${verb}`).not.toContain(verb);
    }
  });

  it('bounds every list query, so one long history cannot hang a page', () => {
    const selects = SOURCE.match(/\.from\(/g) ?? [];
    const limits = SOURCE.match(/\.limit\(/g) ?? [];

    // Every `from` except the two single-row reads (`profiles`, one session)
    // is a list and carries a limit.
    expect(limits.length).toBeGreaterThanOrEqual(selects.length - 3);
  });

  /**
   * The day boundary is the reader's, never the server's.
   *
   * `String(created_at).slice(0, 10)` is the tempting one-liner and it is UTC —
   * so a drill at 9pm in Los Angeles lands on tomorrow's row, and the chart
   * quietly attributes half of somebody's evenings to the wrong day. There is
   * no unit test that can catch that without a database, so it is caught here.
   */
  it('resolves days through localDay, never by slicing a timestamp', () => {
    expect(SOURCE).toContain('localDay(timeZone');
    expect(SOURCE).not.toMatch(/created_at\)?\)?\.slice\(/);
    expect(SOURCE).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
  });

  it('reads the stored frequencies rather than re-deriving them', () => {
    // `chart_version` exists so a retune cannot rewrite history. Re-grading in
    // the review layer would throw that away silently.
    expect(SOURCE).toContain('frequencies');
    expect(SOURCE).not.toContain('createChartStrategy');
    expect(SOURCE).not.toContain('gradeAnswer');
  });
});
