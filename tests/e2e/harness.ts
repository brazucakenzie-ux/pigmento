import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface AppHandle {
  app: ElectronApplication;
  page: Page;
  userData: string;
  errors: string[];
  close(): Promise<void>;
}

/** Launch the built app (out/) with an isolated user-data folder and console error capture. */
export async function launchApp(extraArgs: string[] = []): Promise<AppHandle> {
  const userData = mkdtempSync(path.join(tmpdir(), 'pigmento-e2e-'));
  const app = await electron.launch({
    args: ['.', ...extraArgs],
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, PIGMENTO_USER_DATA: userData, PIGMENTO_E2E: '1' },
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.waitForLoadState('domcontentloaded');
  return {
    app,
    page,
    userData,
    errors,
    async close() {
      await app.evaluate(({ BrowserWindow }) => {
        // Skip the unsaved-changes prompt in tests.
        for (const w of BrowserWindow.getAllWindows()) w.destroy();
      });
      await app.close().catch(() => undefined);
      rmSync(userData, { recursive: true, force: true });
    },
  };
}
