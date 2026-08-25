import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Engine purity, enforced as a lint rule rather than a convention.
 *
 * `packages/engine` must run unchanged in a React Native JS runtime in v2
 * (docs/01-architecture.md). An import restriction alone is not enough:
 * `window`, `document` and `process.env` are *globals*, not imports, and slip
 * past `no-restricted-imports` untouched. Hence three rules, not one.
 *
 * A second, independent gate lives in packages/engine/tsconfig.json, which
 * sets `lib: ["ES2022"]` and `types: []` so those globals are not even
 * declared. A violation therefore fails `pnpm typecheck` as well as `pnpm lint`.
 *
 * These rules apply to `src/**` only. Tests may use Node APIs — they never
 * ship to React Native.
 */
const ENGINE_PURITY_MESSAGE =
  'packages/engine must stay portable: no React, DOM, Node or env access. See docs/01-architecture.md.';

const RESTRICTED_NODE_BUILTINS = [
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dns', 'events',
  'fs', 'http', 'https', 'module', 'net', 'os', 'path', 'process', 'querystring',
  'readline', 'stream', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm',
  'worker_threads', 'zlib',
];

const RESTRICTED_GLOBALS = [
  'window', 'document', 'navigator', 'location', 'history',
  'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest',
  'process', '__dirname', '__filename', 'require', 'Buffer',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/next-env.d.ts',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/coverage/**',
      // Deliberate violations, linted programmatically by the purity test.
      '**/*.fixture.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    name: 'engine/purity',
    files: ['packages/engine/src/**/*.{ts,tsx,mts,cts}'],
    // S5: a boundary that "fails CI rather than relying on discipline"
    // (docs/01-architecture.md) must not have a one-line opt-out.
    linterOptions: { noInlineConfig: true },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*', 'react-*'],
              message: ENGINE_PURITY_MESSAGE,
            },
            {
              group: ['next', 'next/*', '@next/*'],
              message: ENGINE_PURITY_MESSAGE,
            },
            {
              group: ['node:*'],
              message: ENGINE_PURITY_MESSAGE,
            },
            {
              group: RESTRICTED_NODE_BUILTINS,
              message: ENGINE_PURITY_MESSAGE,
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...RESTRICTED_GLOBALS.map((name) => ({ name, message: ENGINE_PURITY_MESSAGE })),
      ],
    },
  },

  {
    // Import and global restrictions above are src-only: tests legitimately use
    // Node APIs and never ship to React Native. The seeded-RNG rule is not —
    // docs/03-poker-engine.md says "no bare Math.random() anywhere in the
    // package", and an irreproducible test is the exact risk it guards against.
    name: 'engine/seeded-rng',
    files: ['packages/engine/**/*.{ts,tsx,mts,cts}'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded RNG from engine/rng. Bare Math.random() makes drills irreproducible.',
        },
      ],
    },
  },
);
