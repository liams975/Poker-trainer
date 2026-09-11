import { readFileSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

/**
 * The e2e suite runs against the real local stack, and one test verifies the
 * Phase 4 -> Phase 5 contract by reading `profiles` back with the service role.
 * That key lives in the root .env.local alongside everything else; real
 * environment variables win so CI supplies them without a file.
 */
function loadRootEnv(): void {
  let raw: string;
  try {
    raw = readFileSync('.env.local', 'utf8');
  } catch {
    return;
  }

  for (const line of raw.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match?.[1] && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2]?.trim().replace(/^["']|["']$/g, '') ?? '';
    }
  }
}

loadRootEnv();

/**
 * Port 3000 is the Next default, which means it is also every *other* Next
 * project's default. `E2E_PORT` moves this suite out of the way when something
 * else already has it — `global-setup.ts` is what refuses to run against that
 * something else, and says to set this.
 */
const PORT = Number(process.env.E2E_PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;

// Read back by `global-setup.ts`, which Playwright gives no access to `use`.
process.env.E2E_BASE_URL = BASE_URL;

export default defineConfig({
  testDir: './apps/web/e2e',
  globalSetup: './apps/web/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @poker/web dev',
    // Next reads PORT, so the dev server follows E2E_PORT without the command
    // needing to know how to pass a flag through pnpm's filter.
    env: { PORT: String(PORT) },
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
