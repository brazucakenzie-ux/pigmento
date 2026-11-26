// AI assistants (Milestone 8): an MCP client connected the way any client connects, through
// `Pigmento --mcp` (stdio), and over the local HTTP address when that's turned on.
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { connectStdio as connect, decode as decodeIn, firstText, imageOf, near, setAssistants as setIn, type Pixel } from './assistantClient';
import { launchApp, ready, type AppHandle } from './harness';

let h: AppHandle;
const clients: Client[] = [];

test.beforeEach(async () => {
  h = await launchApp();
  await ready(h.page);
});

const connectStdio = () => connect(h, clients);
const setAssistants = (change: Record<string, unknown>) => setIn(h, change);
const decode = (base64: string, points: { x: number; y: number }[]) => decodeIn(h, base64, points);

test.afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close().catch(() => undefined)));
  expect(h.errors).toEqual([]);
  await h.close();
});

test('an MCP client connects through Pigmento --mcp, finds the tools and reads the picture', async () => {
  const client = await connectStdio();
  expect(client.getServerVersion()).toMatchObject({ name: 'pigmento' });
  expect(client.getInstructions()).toContain('picture pixels');
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  expect(names).toEqual(expect.arrayContaining(['list_windows', 'get_picture_info']));
  // A window tool can name its window; list_windows can't (it lists them).
  const info = tools.find((t) => t.name === 'get_picture_info')!;
  expect(Object.keys((info.inputSchema as { properties?: object }).properties ?? {})).toContain('window');
  expect(info.annotations?.readOnlyHint).toBe(true);

  const windows = await client.callTool({ name: 'list_windows', arguments: {} });
  const list = (windows.structuredContent as { windows: { id: number; current: boolean }[] }).windows;
  expect(list).toHaveLength(1);
  expect(list[0].current).toBe(true);

  const picture = await client.callTool({ name: 'get_picture_info', arguments: {} });
  expect(picture.isError).toBeFalsy();
  expect(firstText(picture)).toMatch(/1280 × 800 pixels, 1 layer/);
  expect(picture.structuredContent).toMatchObject({ width: 1280, height: 800, unsavedChanges: false, animation: { length: 24 } });
  // The same, naming the window.
  const named = await client.callTool({ name: 'get_picture_info', arguments: { window: list[0].id } });
  expect(named.structuredContent).toMatchObject({ width: 1280 });
  const missing = await client.callTool({ name: 'get_picture_info', arguments: { window: 9999 } });
  expect(missing.isError).toBe(true);
  expect(firstText(missing)).toMatch(/no Pigmento window 9999/);
});

test('a kind of thing turned off in the settings is refused, saying where to turn it on', async () => {
  const client = await connectStdio();
  await setAssistants({ look: 'deny' });
  const r = await client.callTool({ name: 'get_picture_info', arguments: {} });
  expect(r.isError).toBe(true);
  expect(firstText(r)).toMatch(/doesn’t let AI assistants look at pictures \(Settings → AI assistants\)/);
  await setAssistants({ look: 'allow' });
  expect((await client.callTool({ name: 'get_picture_info', arguments: {} })).isError).toBeFalsy();
});

test('the local HTTP address works once turned on, with its token, and never for a web page', async () => {
  const port = 39500 + Math.floor(Math.random() * 400);
  await setAssistants({ http: true, httpPort: port });
  const token = await h.page.evaluate(async () => (await window.pigmento.settings.get()).assistants.httpToken);
  expect(token).toMatch(/^[0-9a-f]{48}$/);
  const url = `http://127.0.0.1:${port}/mcp/${token}`;
  // A web page (it sends an Origin) and a wrong token get nothing.
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } };
  const post = (u: string, headers: Record<string, string> = {}) =>
    fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(init) });
  expect((await post(url, { origin: 'https://example.com' })).status).toBe(403);
  expect((await post(`http://127.0.0.1:${port}/mcp/wrong`)).status).toBe(404);
  // A client with the address does.
  const client = new Client({ name: 'e2e-http', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  clients.push(client);
  const r = await client.callTool({ name: 'get_picture_info', arguments: {} });
  expect(r.structuredContent).toMatchObject({ width: 1280, height: 800 });
  // Turned off again, the address stops answering.
  await setAssistants({ http: false });
  await expect.poll(async () => (await post(url).catch(() => null))?.status ?? 'closed').toBe('closed');
});

test('you see who is connected and what they do, and can stop them, or have them ask first', async () => {
  const { page } = h;
  const client = await connectStdio();
  // The badge names the assistant; its calls show in Assistant activity.
  const badge = page.locator('.assistant-badge');
  await expect(badge).toHaveText('e2e-client');
  await client.callTool({ name: 'get_picture_info', arguments: {} });
  const activity = page.locator('.panel-section-assistants');
  await expect(activity.locator('.assistant-log li').first()).toContainText('Picture info');
  await expect(activity.locator('.assistant-log li').first()).toContainText('by e2e-client');

  // Stopped from the badge: calls are refused, and say so in the activity.
  await badge.click();
  await page.getByRole('dialog', { name: 'AI assistants' }).getByRole('button', { name: 'Stop assistants' }).click();
  await expect(badge).toHaveText('Assistants stopped');
  const stopped = await client.callTool({ name: 'get_picture_info', arguments: {} });
  expect(stopped.isError).toBe(true);
  expect(firstText(stopped)).toMatch(/stopped AI assistants/);
  await expect(activity.locator('.assistant-log li.failed').first()).toContainText('stopped');
  // The shortcut lets them go on.
  await page.keyboard.press('Escape');
  await page.locator('.canvas-host').focus();
  await page.keyboard.press('Control+Shift+Q');
  await expect(badge).toHaveText('e2e-client');
  expect((await client.callTool({ name: 'get_picture_info', arguments: {} })).isError).toBeFalsy();

  // Ask each time: Pigmento's own dialog, naming the assistant and what it wants.
  await setAssistants({ look: 'ask' });
  const ask = page.getByRole('dialog', { name: 'e2e-client wants to go ahead' });
  const denied = client.callTool({ name: 'get_picture_info', arguments: {} });
  await expect(ask).toContainText('e2e-client wants to look at pictures: Picture info.');
  await ask.getByRole('button', { name: 'Don’t allow' }).click();
  const d = await denied;
  expect(d.isError).toBe(true);
  expect(firstText(d)).toMatch(/didn’t allow/);
  const allowed = client.callTool({ name: 'get_picture_info', arguments: {} });
  await ask.getByRole('button', { name: 'Allow', exact: true }).click();
  expect((await allowed).structuredContent).toMatchObject({ width: 1280 });

  // When it goes, the badge does too.
  await client.close();
  clients.splice(clients.indexOf(client), 1);
  await expect(badge).toHaveCount(0);
});

const RED: Pixel = { r: 220, g: 30, b: 30, a: 255 };
const BLUE: Pixel = { r: 30, g: 60, b: 220, a: 255 };
const GREEN: Pixel = { r: 30, g: 200, b: 60, a: 255 };

test('an assistant looks at the picture as a PNG that matches the screen: all of it, a layer, a region or a frame', async () => {
  const { page } = h;
  const client = await connectStdio();
  // Red on the background; blue on a second layer, which gets a second drawing (green) at frame 3.
  const bg = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate(([id, c]) => window.__pigmentoTest!.fillLayer(id, c, { x: 100, y: 100, w: 200, h: 150 }), [bg, RED] as const);
  await page.evaluate(() => window.__pigmentoTest!.addLayer());
  const top = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate(([id, c]) => window.__pigmentoTest!.fillLayer(id, c, { x: 600, y: 300, w: 100, h: 100 }), [top, BLUE] as const);

  // Picture info says what's in use, with frames numbered as in the timeline.
  const info = await client.callTool({ name: 'get_picture_info', arguments: {} });
  expect(info.structuredContent).toMatchObject({ tool: { id: 'pencil', name: 'Pencil' }, colors: { primary: '#000000ff', secondary: '#ffffffff' }, animation: { frame: 1, length: 24 } });

  // All of it, at its real size: the same pixels as the screen.
  const points = [
    { x: 200, y: 175 },
    { x: 650, y: 350 },
    { x: 20, y: 20 },
    { x: 1279, y: 799 },
  ];
  const screen = await page.evaluate((p) => window.__pigmentoTest!.screenPixels(p), points);
  const full = await client.callTool({ name: 'get_picture_image', arguments: { maxSize: 2048 } });
  expect(full.isError).toBeFalsy();
  expect(full.structuredContent).toMatchObject({ width: 1280, height: 800, scale: 1, frame: 1, region: { x: 0, y: 0, width: 1280, height: 800 }, layer: null });
  expect(imageOf(full)?.mimeType).toBe('image/png');
  const fullPng = await decode(imageOf(full)!.data!, points);
  expect([fullPng.width, fullPng.height]).toEqual([1280, 800]);
  fullPng.pixels.forEach((p, i) => expect(near(p, screen[i] as Pixel, 1), `point ${i}: ${JSON.stringify(p)} vs ${JSON.stringify(screen[i])}`).toBe(true));
  expect(near(fullPng.pixels[0], RED)).toBe(true);
  expect(near(fullPng.pixels[1], BLUE)).toBe(true);

  // Scaled down to fit (1024 by default).
  const small = await client.callTool({ name: 'get_picture_image', arguments: {} });
  expect(small.structuredContent).toMatchObject({ width: 1024, height: 640, scale: 0.8 });
  expect(firstText(small)).toContain('shown at 1024 × 640 (80%)');
  const smallPng = await decode(imageOf(small)!.data!, [
    { x: 160, y: 140 },
    { x: 520, y: 280 },
  ]);
  expect([smallPng.width, smallPng.height]).toEqual([1024, 640]);
  expect(near(smallPng.pixels[0], RED)).toBe(true);
  expect(near(smallPng.pixels[1], BLUE)).toBe(true);

  // A region, at its real size; a region reaching outside is cut to the picture.
  const region = await client.callTool({ name: 'get_picture_image', arguments: { region: { x: 150, y: 120, width: 100, height: 100 } } });
  expect(region.structuredContent).toMatchObject({ width: 100, height: 100, scale: 1 });
  expect(near((await decode(imageOf(region)!.data!, [{ x: 50, y: 55 }])).pixels[0], RED)).toBe(true);
  const corner = await client.callTool({ name: 'get_picture_image', arguments: { region: { x: 1200, y: 700, width: 500, height: 500 } } });
  expect(corner.structuredContent).toMatchObject({ width: 80, height: 100, region: { x: 1200, y: 700, width: 80, height: 100 } });

  // One layer alone: see-through around what's on it.
  const layer = await client.callTool({ name: 'get_picture_image', arguments: { layer: top, maxSize: 2048 } });
  expect(firstText(layer)).toMatch(/^The layer “/);
  const layerPng = await decode(imageOf(layer)!.data!, [
    { x: 650, y: 350 },
    { x: 200, y: 175 },
  ]);
  expect(near(layerPng.pixels[0], BLUE)).toBe(true);
  expect(layerPng.pixels[1].a).toBe(0);

  // Another frame: the second layer's drawing from frame 3 is green.
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.evaluate(() => window.__pigmentoTest!.setFrame(2));
  await page.locator('.ribbon').getByRole('button', { name: 'New drawing' }).click();
  await page.evaluate(([id, c]) => window.__pigmentoTest!.fillLayer(id, c, { x: 900, y: 500, w: 100, h: 100 }), [top, GREEN] as const);
  await page.evaluate(() => window.__pigmentoTest!.setFrame(0));
  const look = async (frame: number) => {
    const r = await client.callTool({ name: 'get_picture_image', arguments: { frame, maxSize: 2048 } });
    expect(r.structuredContent).toMatchObject({ frame });
    expect(firstText(r)).toContain(`at frame ${frame} of 24`);
    return (
      await decode(imageOf(r)!.data!, [
        { x: 650, y: 350 },
        { x: 950, y: 550 },
      ])
    ).pixels;
  };
  const [blue1, green1] = await look(1);
  expect(near(blue1, BLUE)).toBe(true);
  expect(near(green1, GREEN)).toBe(false);
  const [blue3, green3] = await look(3);
  expect(near(blue3, BLUE)).toBe(false);
  expect(near(green3, GREEN)).toBe(true);
  // Looking doesn't move the timeline.
  expect(await page.evaluate(() => window.__pigmentoTest!.anim().frame)).toBe(0);

  // What can't be shown is explained.
  const refusals: [Record<string, unknown>, RegExp][] = [
    [{ frame: 99 }, /frame can be 1 to 24/],
    [{ layer: 'nope' }, /no layer nope\. get_picture_info lists the layers/],
    [{ region: { x: 5000, y: 0, width: 10, height: 10 } }, /outside the picture, which is 1280 × 800 pixels/],
  ];
  for (const [args, message] of refusals) {
    const r = await client.callTool({ name: 'get_picture_image', arguments: args });
    expect(r.isError).toBe(true);
    expect(firstText(r)).toMatch(message);
  }
});

test('an assistant finds what Pigmento has, and reads the same views as resources', async () => {
  const client = await connectStdio();
  const list = async (what: string) => {
    const r = await client.callTool({ name: 'list_available', arguments: { what } });
    expect(r.isError).toBeFalsy();
    const items = (r.structuredContent as Record<string, Record<string, unknown>[]>)[what];
    expect(firstText(r)).toBe(`Pigmento has ${items.length} ${what}.`);
    return items;
  };
  expect(await list('tools')).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'pencil', name: 'Pencil', shortcut: expect.any(String) })]));
  expect((await list('brushes')).length).toBeGreaterThan(10);
  expect((await list('shapes')).length).toBeGreaterThan(10);
  const effects = await list('effects');
  expect(effects).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'adjustment' }), expect.objectContaining({ kind: 'filter' })]));
  expect(effects.some((e) => Array.isArray(e.settings) && e.settings.length > 0)).toBe(true);
  expect(await list('actions')).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'stopAssistants', name: 'Stop AI assistants', shortcut: 'Ctrl+Shift+Q', enabled: true })]));
  const wrong = await client.callTool({ name: 'list_available', arguments: { what: 'spoons' } });
  expect(wrong.isError).toBe(true);

  // Resources: the windows, the picture's info and the picture itself.
  const { resources } = await client.listResources();
  expect(resources.map((r) => r.uri).sort()).toEqual(['pigmento://picture/image', 'pigmento://picture/info', 'pigmento://windows']);
  const info = await client.readResource({ uri: 'pigmento://picture/info' });
  expect(info.contents[0].mimeType).toBe('application/json');
  expect(JSON.parse((info.contents[0] as { text: string }).text)).toMatchObject({ width: 1280, height: 800 });
  const windows = await client.readResource({ uri: 'pigmento://windows' });
  expect(JSON.parse((windows.contents[0] as { text: string }).text).windows).toHaveLength(1);
  const image = await client.readResource({ uri: 'pigmento://picture/image' });
  expect(image.contents[0].mimeType).toBe('image/png');
  const png = await decode((image.contents[0] as { blob: string }).blob, [{ x: 0, y: 0 }]);
  expect([png.width, png.height]).toEqual([1024, 640]);
  // Reading them is looking: refused when looking isn't allowed.
  await setAssistants({ look: 'deny' });
  await expect(client.readResource({ uri: 'pigmento://picture/info' })).rejects.toThrow(/doesn’t let AI assistants look at pictures/);
});

test('on-demand setting is on by default: MCP connects without opening Pigmento, and opens it on the first tool call', async () => {
  // Verify the toggle in Settings → AI assistants is on by default and persists when flipped.
  const { page } = h;
  await page.keyboard.press('Control+Alt+s');
  await page.getByRole('tab', { name: 'AI assistants' }).click();
  const toggle = page.getByRole('checkbox', { name: 'Only open Pigmento when an assistant uses it' });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect.poll(() => page.evaluate(async () => (await window.pigmento.settings.get()).assistants.openOnDemand)).toBe(false);
  await toggle.check();
  await expect.poll(() => page.evaluate(async () => (await window.pigmento.settings.get()).assistants.openOnDemand)).toBe(true);
  await page.keyboard.press('Escape');

  // Fresh profile with NO Pigmento window running: connecting via --mcp discovers tools without opening Pigmento.
  const userData = mkdtempSync(path.join(os.tmpdir(), 'pigmento-ondemand-'));
  const pipe = `\\\\.\\pipe\\pigmento-mcp-${createHash('sha256').update(userData.toLowerCase()).digest('hex').slice(0, 16)}`;
  const canConnectPipe = () =>
    new Promise<boolean>((resolve) => {
      const s = net.connect(pipe);
      s.once('connect', () => {
        s.destroy();
        resolve(true);
      });
      s.once('error', () => resolve(false));
    });
  const electronExe = createRequire(__filename)('electron') as unknown as string;
  const transport = new StdioClientTransport({
    command: electronExe,
    args: ['.', '--mcp'],
    cwd: path.resolve(__dirname, '../..'),
    env: { ...(process.env as Record<string, string>), PIGMENTO_USER_DATA: userData },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'ondemand-e2e', version: '1.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('get_picture_info');
    expect((await client.listResources()).resources).toHaveLength(3);
    // Still no Pigmento instance listening on this profile's pipe.
    expect(await canConnectPipe()).toBe(false);

    // Calling a tool opens Pigmento on demand and answers normally.
    const info = await client.callTool({ name: 'get_picture_info', arguments: {} });
    expect(info.isError).toBeFalsy();
    expect(info.structuredContent).toMatchObject({ width: 1280, height: 800, dpi: 96 });
    expect(await canConnectPipe()).toBe(true);
  } finally {
    await client.close().catch(() => undefined);
    // Stop the detached Pigmento app launched for this temporary profile.
    try {
      const escaped = userData.replace(/'/g, "''");
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `$p = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${escaped}*' }; $parents = $p | ForEach-Object { $_.ParentProcessId } | Sort-Object -Unique | Where-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName -eq 'electron' }; foreach ($id in @($p.ProcessId) + @($parents)) { if ($id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } }`,
        ],
        { stdio: 'ignore' },
      );
    } catch {
      // ignore if already exited
    }
    rmSync(userData, { recursive: true, force: true });
  }
});
