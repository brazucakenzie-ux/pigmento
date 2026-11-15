import { defineConfig } from '@playwright/test';

/** Smoke tests of the installed app (scripts/smoke-installed.ps1); not part of `npm run check`. */
export default defineConfig({
  testDir: 'tests/installed',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
});
