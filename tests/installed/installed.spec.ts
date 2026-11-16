import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/**
 * Smoke test of the installed app (run after installing dist/Pigmento Setup *.exe; see
 * scripts/smoke-installed.ps1). It launches the installed Pigmento.exe exactly as Windows would
 * through the file association and "Open with", with a temporary profile.
 */
const EXE = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Pigmento', 'Pigmento.exe');

/** The command Windows runs for a registered file type, with the file put in for %1. */
function registered(progId: string, file: string): { exe: string; args: string[] } {
  const out = execFileSync('reg', ['query', `HKCU\\Software\\Classes\\${progId}\\shell\\open\\command`, '/ve'], { encoding: 'utf8' });
  // The program may be quoted or not (a path without spaces needn't be).
  const m = /REG_SZ\s+(?:"([^"]+)"|(\S+))\s+"%1"/.exec(out);
  if (!m) throw new Error(`No open command for ${progId}: ${out}`);
  return { exe: m[1] ?? m[2], args: [file] };
}

function progIdFor(ext: string): string {
  const out = execFileSync('reg', ['query', `HKCU\\Software\\Classes\\.${ext}`, '/ve'], { encoding: 'utf8' });
  const m = /REG_SZ\s+(\S+)/.exec(out);
  if (!m) throw new Error(`.${ext} isn't associated`);
  return m[1];
}

let profile = '';
let app: ElectronApplication | null = null;

async function start(args: string[] = [], exe = EXE): Promise<Page> {
  app = await electron.launch({ executablePath: exe, args, env: { ...process.env, PIGMENTO_USER_DATA: profile, PIGMENTO_E2E: '1' } });
  const page = await app.firstWindow();
  await page.waitForSelector('.ribbon');
  return page;
}

async function stop(): Promise<void> {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => undefined);
  await app?.close().catch(() => undefined);
  app = null;
}

test.beforeAll(() => {
  test.skip(!existsSync(EXE), `Install Pigmento first (${EXE} not found)`);
  profile = mkdtempSync(path.join(tmpdir(), 'pigmento-installed-'));
});

test.afterAll(async () => {
  await stop();
  if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('the installed app starts, draws, saves a project and reopens it through its file association', async () => {
  const page = await start();
  // It's the packaged build.
  const info = await page.evaluate(() => window.pigmento.system.appInfo());
  const version = (JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as { version: string }).version;
  expect(info).toMatchObject({ version, isPackaged: true });
  await expect(page).toHaveTitle(/Pigmento/);

  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await page.keyboard.press('b');
  const at = (x: number, y: number) => page.evaluate(([px, py]) => window.__pigmentoTest!.docToScreen(px, py), [x, y] as const);
  const a = await at(100, 100);
  const b = await at(500, 100);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  const drawn = await page.evaluate(() => window.__pigmentoTest!.pixel(300, 100));
  expect(drawn.g).toBeLessThan(100);

  const project = path.join(profile, 'smoke.pigm');
  await app!.evaluate(({ dialog }, fp) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: fp })) as typeof dialog.showSaveDialog;
  }, project);
  await page.keyboard.press('Control+Shift+s');
  await expect.poll(() => existsSync(project)).toBe(true);
  await expect(page).toHaveTitle(/smoke/);
  // The smoke script double-clicks a copy of it through Windows itself.
  if (process.env.PIGMENTO_SMOKE_OUT) copyFileSync(project, path.join(process.env.PIGMENTO_SMOKE_OUT, 'double-click.pigm'));
  await stop();

  // Exactly what Windows runs when a .pigm file is opened.
  const cmd = registered(progIdFor('pigm'), project);
  expect(path.resolve(cmd.exe).toLowerCase()).toBe(path.resolve(EXE).toLowerCase());
  const reopened = await start(cmd.args, cmd.exe);
  await expect(reopened).toHaveTitle(/smoke/);
  expect(await reopened.evaluate(() => window.__pigmentoTest!.pixel(300, 100))).toEqual(drawn);
  await stop();
});

test('"Open with" lists Pigmento for images and opens them', async () => {
  // Registered for "Open with" without becoming the default.
  const withPng = execFileSync('reg', ['query', 'HKCU\\Software\\Classes\\.png\\OpenWithProgids'], { encoding: 'utf8' });
  expect(withPng).toContain('Pigmento.Image');
  // A 3 × 2 PNG (made by the app itself), opened the way "Open with" does.
  const page = await start();
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(3, 2);
    c.getContext('2d')!.fillRect(0, 0, 3, 2);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  await stop();
  const file = path.join(profile, 'tiny.png');
  writeFileSync(file, Buffer.from(png));
  const cmd = registered('Pigmento.Image', file);
  const opened = await start(cmd.args, cmd.exe);
  await expect(opened).toHaveTitle(/tiny/);
  expect(await opened.evaluate(() => window.__pigmentoTest!.doc())).toEqual({ width: 3, height: 2 });
  await stop();
});
