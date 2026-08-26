import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'engine',
          root: './packages/engine',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
          // Deliberately NOT passWithNoTests: deleting or renaming
          // purity.test.ts must fail the suite, not silently pass it.
        },
      },
      {
        test: {
          // Pure helpers only — anything in apps/web that can be tested
          // without a browser or a database. The shell itself is covered by
          // Playwright, which exercises it the way a user does; this project
          // exists so that logic like the open-redirect sanitiser is checked
          // on every save rather than only in the e2e job.
          name: 'web',
          root: './apps/web',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'content',
          root: './packages/content',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
          // Deliberately NOT passWithNoTests, for the same reason the engine
          // project omits it: charts.test.ts carries the Phase 2 exit criteria,
          // and deleting it must fail the suite rather than silently pass it.
        },
      },
    ],
  },
});
