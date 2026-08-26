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

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @poker/web dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
