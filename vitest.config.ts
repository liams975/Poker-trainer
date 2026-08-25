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
          name: 'content',
          root: './packages/content',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
          passWithNoTests: true,
        },
      },
    ],
  },
});
