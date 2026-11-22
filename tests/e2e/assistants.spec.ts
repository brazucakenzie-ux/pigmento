// AI assistants (Milestone 8): an MCP client connected the way any client connects, through
// `Pigmento --mcp` (stdio), and over the local HTTP address when that's turned on.
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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

const electronExe = createRequire(__filename)('electron') as unknown as string;

/** An MCP client started the way any client starts Pigmento: `Pigmento --mcp`, on the test's profile. */
async function connectStdio(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: electronExe,
    args: ['.', '--mcp'],
    cwd: path.resolve(__dirname, '../..'),
    env: { ...(process.env as Record<string, string>), PIGMENTO_USER_DATA: h.userData },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'e2e-client', version: '1.0.0' });
  await client.connect(transport);
  clients.push(client);
  return client;
}

type Text = { type: string; text?: string };
const firstText = (r: unknown) => ((r as { content?: Text[] }).content ?? []).find((c) => c.type === 'text')?.text ?? '';

/** Change the AI assistants settings, as the Settings tab would. */
const setAssistants = (change: Record<string, unknown>) =>
  h.page.evaluate(async (c) => {
    const s = await window.pigmento.settings.get();
    await window.pigmento.settings.set({ assistants: { ...s.assistants, ...c } });
  }, change);

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
