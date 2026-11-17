import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import './globals.d';

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
  return start(userData, extraArgs);
}

/**
 * Start the app again on the same user-data folder (settings, autosaves) after `h.app` has
 * exited or been killed. Retries while a dying instance still holds the single-instance lock.
 */
export async function relaunch(h: AppHandle, attempts = 1): Promise<AppHandle> {
  // Release Playwright's handle on the old app, or the test worker can't exit.
  await h.app.close().catch(() => undefined);
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 800));
    try {
      return await start(h.userData, [], attempts > 1 ? 8000 : undefined);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('App did not restart');
}

async function start(userData: string, extraArgs: string[], windowTimeout?: number): Promise<AppHandle> {
  const app = await electron.launch({
    args: ['.', ...extraArgs],
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, PIGMENTO_USER_DATA: userData, PIGMENTO_E2E: '1' },
  });
  let page: Page;
  try {
    page = await app.firstWindow(windowTimeout === undefined ? undefined : { timeout: windowTimeout });
  } catch (err) {
    await app.close().catch(() => undefined);
    throw err;
  }
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
      await app
        .evaluate(({ BrowserWindow }) => {
          // Skip the unsaved-changes prompt in tests.
          for (const w of BrowserWindow.getAllWindows()) w.destroy();
        })
        .catch(() => undefined);
      await app.close().catch(() => undefined);
      try {
        rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch {
        // Chromium may still hold a lock file briefly; the OS temp folder is cleaned later.
      }
    },
  };
}

/** Wait until the UI and test hook are ready, and the picture has stopped moving on screen. */
export async function ready(page: Page): Promise<void> {
  await page.waitForSelector('.ribbon');
  await page.waitForFunction(() => window.__pigmentoTest !== undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await settle(page);
}

/**
 * Wait until the picture holds still on screen (the same place and zoom for four frames). The view
 * moves a moment after the canvas area changes size (the font loading, the timeline opening), and
 * a drag measured before that lands in the wrong place, which is what made drag tests fail now
 * and then under load.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const at = () => {
      const a = window.__pigmentoTest!.docToScreen(0, 0);
      const b = window.__pigmentoTest!.docToScreen(100, 100);
      return `${a.x},${a.y},${b.x},${b.y}`;
    };
    let last = at();
    let still = 0;
    for (let i = 0; i < 180 && still < 4; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const now = at();
      still = now === last ? still + 1 : 0;
      last = now;
    }
  });
}

/** Where a document point is on screen, once the view has settled. */
export async function docToScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  await settle(page);
  return page.evaluate(([dx, dy]) => window.__pigmentoTest!.docToScreen(dx, dy), [x, y] as const);
}

export async function pixel(page: Page, x: number, y: number): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(([dx, dy]) => window.__pigmentoTest!.pixel(dx, dy), [x, y] as const);
}

/** Drag through doc-space points with the given button. */
export async function drag(page: Page, points: [number, number][], button: 'left' | 'right' = 'left'): Promise<void> {
  // (docToScreen settles the view first, so the whole drag uses one view.)
  const first = await docToScreen(page, points[0][0], points[0][1]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down({ button });
  for (const [x, y] of points.slice(1)) {
    const s = await docToScreen(page, x, y);
    await page.mouse.move(s.x, s.y, { steps: 6 });
  }
  await page.mouse.up({ button });
}

export async function clickDoc(page: Page, x: number, y: number, button: 'left' | 'right' = 'left'): Promise<void> {
  const s = await docToScreen(page, x, y);
  await page.mouse.click(s.x, s.y, { button });
}

export function tempFile(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pigmento-files-'));
  return path.join(dir, name);
}
