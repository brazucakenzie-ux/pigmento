// AI assistants, Stop 8B: pictures and their files (8.7), through an MCP client on `Pigmento --mcp`.
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectStdio, firstText, setAssistants } from './assistantClient';
import { launchApp, ready, type AppHandle } from './harness';

let h: AppHandle;
const clients: Client[] = [];

test.beforeEach(async () => {
  h = await launchApp();
  await ready(h.page);
});

test.afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close().catch(() => undefined)));
  expect(h.errors).toEqual([]);
  await h.close();
});

/** A PNG file's size, from its header. */
const pngSize = (file: string) => {
  const b = readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

test('an assistant makes, saves, exports, opens, switches and closes pictures, never losing unsaved work by accident', async () => {
  const client = await connectStdio(h, clients);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { ok: !r.isError, text: firstText(r), data: r.structuredContent as Record<string, unknown> | undefined };
  };
  const info = async (window?: number) => (await call('get_picture_info', window ? { window } : {})).data as { width: number; height: number; name: string; unsavedChanges: boolean; layers: unknown[] };
  const windows = async () => ((await call('list_windows')).data as { windows: { id: number; current: boolean }[] }).windows;
  const dir = path.join(h.userData, 'Pictures');
  mkdirSync(path.join(dir, 'Limited'), { recursive: true });
  const first = (await windows())[0].id;

  // A new picture goes in this window while it has nothing unsaved.
  const made = await call('new_picture', { width: 400, height: 300, paper: '#ff0000' });
  expect(made.ok).toBe(true);
  expect(made.data).toMatchObject({ width: 400, height: 300, window: first });
  expect(await info()).toMatchObject({ width: 400, height: 300, unsavedChanges: false });
  expect(await page().evaluate(() => window.__pigmentoTest!.pixel(10, 10))).toEqual({ r: 255, g: 0, b: 0, a: 255 });

  // Save: it needs a path first; a .pigm keeps the layers; saving again to its own file is plain Save.
  await page().evaluate(() => window.__pigmentoTest!.addLayer());
  expect((await call('save_file')).text).toMatch(/never been saved: give a path/);
  const pigm = path.join(dir, 'Scene.pigm');
  expect(await call('save_file', { path: pigm })).toMatchObject({ ok: true, data: { format: 'pigm', keptEverything: true, unsavedChanges: false } });
  expect(existsSync(pigm)).toBe(true);
  expect(await info()).toMatchObject({ name: 'Scene.pigm', unsavedChanges: false });
  expect((await call('save_file')).ok).toBe(true);
  // A flat file keeps only how it looks, and says so.
  const png = path.join(dir, 'Scene.png');
  const flat = await call('save_file', { path: png });
  expect(flat.text).toMatch(/PNG keeps the picture as it looks, not its layers/);
  expect(flat.data).toMatchObject({ format: 'png', keptEverything: false });
  // An existing file is replaced only when the assistant says so.
  expect((await call('save_file', { path: png })).text).toMatch(/already exists\. Say overwrite: true/);
  expect((await call('save_file', { path: png, overwrite: true })).ok).toBe(true);
  expect((await call('save_file', { path: path.join(dir, 'Scene.txt') })).text).toMatch(/has to end in \.pigm/);
  expect((await call('save_file', { path: 'Scene.png' })).text).toMatch(/full path/);

  // Export: a copy at a scale; the picture and its file don't change.
  const half = path.join(dir, 'Half.png');
  expect(await call('export_image', { path: half, scale: 0.5 })).toMatchObject({ ok: true, data: { width: 200, height: 150 } });
  expect(pngSize(half)).toEqual({ width: 200, height: 150 });
  expect((await call('export_image', { path: half })).text).toMatch(/already exists/);
  expect((await call('export_image', { path: path.join(dir, 'x.pigm') })).text).toMatch(/save_file saves \.pigm/);
  expect(await info()).toMatchObject({ name: 'Scene.png' });

  // With unsaved work here, a new picture opens a new window, which is the one worked in next.
  await page().evaluate(() => window.__pigmentoTest!.addLayer());
  const other = await call('new_picture', { width: 100, height: 80 });
  expect(other.ok).toBe(true);
  const second = other.data!.window as number;
  expect(second).not.toBe(first);
  expect((await windows()).map((w) => [w.id, w.current])).toEqual(expect.arrayContaining([[first, false], [second, true]]));
  expect(await info()).toMatchObject({ width: 100, height: 80 });
  expect(await info(first)).toMatchObject({ width: 400, height: 300, unsavedChanges: true });

  // Switching brings a window to the front.
  expect((await call('focus_window', { window: first })).text).toMatch(/Switched to Scene\.png/);
  expect((await windows()).find((w) => w.current)?.id).toBe(first);
  expect(await info()).toMatchObject({ width: 400 });

  // Replacing unsaved work needs the assistant to say what to do with it.
  expect((await call('new_picture', { width: 50, height: 50, where: 'this' })).text).toMatch(/has unsaved changes\. To make a new picture here, say unsaved: 'save' or 'discard'/);
  expect(await info()).toMatchObject({ width: 400, unsavedChanges: true });

  // Closing: a window with nothing unsaved closes; the last one never does.
  expect((await call('close_window', { window: second })).ok).toBe(true);
  await expect.poll(async () => (await windows()).length).toBe(1);
  expect((await call('close_window', { unsaved: 'discard' })).text).toMatch(/last Pigmento window/);

  // Opening, throwing away what's unsaved here: the .pigm comes back with its two layers.
  const opened = await call('open_file', { path: pigm, where: 'this', unsaved: 'discard' });
  expect(opened).toMatchObject({ ok: true, data: { width: 400, height: 300, window: first } });
  expect(await info()).toMatchObject({ name: 'Scene.pigm', unsavedChanges: false });
  expect((await info()).layers).toHaveLength(2);
  expect((await call('open_file', { path: path.join(dir, 'Missing.png') })).text).toMatch(/no file/);

  // Saving what's unsaved first: back to its own file, then the new picture.
  await page().evaluate(() => window.__pigmentoTest!.addLayer());
  const before = statSync(pigm).mtimeMs;
  expect((await call('new_picture', { width: 64, height: 64, where: 'this', unsaved: 'save' })).ok).toBe(true);
  expect(statSync(pigm).mtimeMs).toBeGreaterThan(before);
  expect(await info()).toMatchObject({ width: 64, height: 64 });

  // The folder limit, and the files permission.
  await setAssistants(h, { folder: path.join(dir, 'Limited') });
  expect((await call('export_image', { path: path.join(dir, 'Out.png') })).text).toMatch(/only lets AI assistants use files in .*Limited/);
  expect((await call('export_image', { path: path.join(dir, 'Limited', 'Out.png') })).ok).toBe(true);
  await setAssistants(h, { folder: null, files: 'deny' });
  expect((await call('open_file', { path: pigm })).text).toMatch(/doesn’t let AI assistants open, save or export files/);
  // Saving unsaved changes is using files too.
  await page().evaluate(() => window.__pigmentoTest!.addLayer());
  expect((await call('new_picture', { width: 10, height: 10, where: 'this', unsaved: 'save' })).text).toMatch(/doesn’t let AI assistants open, save or export files/);
});

/** The first window (the one the test started with). */
const page = () => h.page;
