import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mcpPipeName, runBridge } from '../../src/main/mcp/bridge';
import { createMcpServer, RESOURCES, TOOLS } from '../../src/main/mcp/tools';

const servers: net.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r(null)))));
});

const testPipe = () => `\\\\.\\pipe\\pigmento-test-${randomBytes(6).toString('hex')}`;

/** A stand-in for Pigmento listening on the pipe: answers each line with "re:" and the line. */
function listen(pipe: string, onConnection?: (s: net.Socket) => void): Promise<net.Server> {
  const server = net.createServer((s) => {
    s.setEncoding('utf8');
    s.on('data', (d) => s.write(`re:${d}`));
    onConnection?.(s);
  });
  servers.push(server);
  return new Promise((r) => server.listen(pipe, () => r(server)));
}

/** The client's side of the bridge, with what it's been told. */
function client() {
  const input = new PassThrough();
  const output = new PassThrough();
  const errors: string[] = [];
  let received = '';
  output.setEncoding('utf8');
  output.on('data', (d: string) => (received += d));
  return { io: { input, output, error: (m: string) => errors.push(m) }, input, errors, received: () => received };
}

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  return cond();
};

describe('the MCP bridge', () => {
  it('has a pipe of its own for each profile', () => {
    const a = mcpPipeName('C:\\Users\\Ana\\AppData\\Roaming\\Pigmento');
    expect(a).toMatch(/^\\\\\.\\pipe\\pigmento-mcp-[0-9a-f]{16}$/);
    expect(mcpPipeName('c:\\users\\ana\\appdata\\roaming\\pigmento')).toBe(a);
    expect(mcpPipeName('C:\\Temp\\pigmento-e2e-1')).not.toBe(a);
  });

  it('passes the client’s messages to Pigmento and its answers back, until the client goes', async () => {
    const pipe = testPipe();
    let ended = false;
    await listen(pipe, (s) => s.on('end', () => {
      ended = true;
      s.end();
    }));
    const c = client();
    const done = runBridge(pipe, c.io, () => {
      throw new Error('should not start');
    });
    c.input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    expect(await until(() => c.received().includes('re:{"jsonrpc":"2.0","id":1,"method":"ping"}\n'))).toBe(true);
    c.input.end();
    expect(await done).toBe(0);
    expect(ended).toBe(true);
    expect(c.errors).toEqual([]);
  });

  it('starts Pigmento when nothing is listening, and waits for it', async () => {
    const pipe = testPipe();
    let started = 0;
    const c = client();
    const done = runBridge(
      pipe,
      c.io,
      () => {
        started++;
        setTimeout(() => void listen(pipe), 300);
      },
      { retryMs: 50 },
    );
    c.input.write('hello\n');
    expect(await until(() => c.received() === 're:hello\n')).toBe(true);
    expect(started).toBe(1);
    c.input.end();
    expect(await done).toBe(0);
  });

  it('gives up, saying why, when Pigmento never listens', async () => {
    const c = client();
    expect(await runBridge(testPipe(), c.io, () => undefined, { waitMs: 300, retryMs: 50 })).toBe(1);
    expect(c.errors[0]).toMatch(/didn’t start listening/);
    const d = client();
    expect(
      await runBridge(testPipe(), d.io, () => {
        throw new Error('no exe');
      }),
    ).toBe(1);
    expect(d.errors[0]).toMatch(/couldn't be started: no exe/);
  });

  it('ends when Pigmento closes the conversation', async () => {
    const pipe = testPipe();
    await listen(pipe, (s) => setTimeout(() => s.end('bye\n'), 100));
    const c = client();
    expect(await runBridge(pipe, c.io, () => undefined)).toBe(0);
    expect(c.received()).toBe('bye\n');
  });
});

/** Connect a real MCP Client to an in-process BridgeIo pair. */
function mcpClientOn(c: ReturnType<typeof client>, name = 'antigravity'): { mcp: Client; transport: Transport } {
  const buf = new ReadBuffer();
  const transport: Transport = {
    async start() {
      c.io.output.on('data', (chunk: Buffer | string) => {
        buf.append(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        for (;;) {
          const msg = buf.readMessage();
          if (!msg) break;
          transport.onmessage?.(msg);
        }
      });
    },
    async send(msg: JSONRPCMessage) {
      c.input.write(serializeMessage(msg));
    },
    async close() {
      c.input.end();
      transport.onclose?.();
    },
  };
  const mcp = new Client({ name, version: '1.0.0' });
  return { mcp, transport };
}

/** A real MCP server on a named pipe, mimicking Pigmento's AssistantHost. */
function listenMcp(pipe: string, onInit?: (who: string) => void): Promise<{ server: net.Server; sockets: Set<net.Socket> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
    const mcp = createMcpServer('1.4.1', {
      onInitialized: (who) => onInit?.(who),
      callTool: async (tool, _args, who) => ({ content: [{ type: 'text', text: `${tool.name} for ${who}` }] }),
      readResource: async (uri, res) => ({ contents: [{ uri: uri.href, mimeType: res.mimeType, text: '{"ok":true}' }] }),
    });
    const transport = new StdioServerTransport(s, s);
    s.on('close', () => void transport.close());
    void mcp.connect(transport);
  });
  servers.push(server);
  return new Promise((r) => server.listen(pipe, () => r({ server, sockets })));
}

describe('the MCP bridge (on-demand standby)', () => {
  it('answers initialize, tools/list and resources/list without starting Pigmento, then starts on the first tool call', async () => {
    const pipe = testPipe();
    let started = 0;
    const seenClients: string[] = [];
    const c = client();
    const done = runBridge(
      pipe,
      c.io,
      () => {
        started++;
        setTimeout(() => void listenMcp(pipe, (who) => seenClients.push(who)), 120);
      },
      { retryMs: 30, onDemand: { version: '1.4.1' } },
    );

    const { mcp, transport } = mcpClientOn(c, 'Antigravity');
    await mcp.connect(transport);
    expect(mcp.getServerVersion()).toMatchObject({ name: 'pigmento', version: '1.4.1' });
    const { tools } = await mcp.listTools();
    expect(tools).toHaveLength(TOOLS.length);
    const { resources } = await mcp.listResources();
    expect(resources).toHaveLength(RESOURCES.length);
    await mcp.ping();
    // Discovery never launched Pigmento.
    expect(started).toBe(0);

    // Calling a tool wakes Pigmento on demand and replays the client's name.
    const r = await mcp.callTool({ name: 'get_picture_info', arguments: {} });
    expect(r.isError).toBeFalsy();
    expect((r.content as { text: string }[])[0].text).toBe('get_picture_info for Antigravity');
    expect(started).toBe(1);
    expect(seenClients).toEqual(['Antigravity']);

    await mcp.close();
    expect(await done).toBe(0);
    expect(c.errors).toEqual([]);
  });

  it('returns to standby when Pigmento closes and reconnects on the next tool call', async () => {
    const pipe = testPipe();
    let started = 0;
    let active: { server: net.Server; sockets: Set<net.Socket> } | null = null;
    const c = client();
    const done = runBridge(
      pipe,
      c.io,
      () => {
        started++;
        setTimeout(() => {
          void listenMcp(pipe).then((inst) => (active = inst));
        }, 80);
      },
      { retryMs: 30, onDemand: { version: '1.4.1' } },
    );

    const { mcp, transport } = mcpClientOn(c, 'Antigravity');
    await mcp.connect(transport);
    const first = await mcp.callTool({ name: 'list_windows', arguments: {} });
    expect((first.content as { text: string }[])[0].text).toBe('list_windows for Antigravity');
    expect(started).toBe(1);

    // Simulate the user closing Pigmento: server closes and drops its socket.
    for (const s of active!.sockets) s.destroy();
    await new Promise((r) => active!.server.close(() => r(null)));
    active = null;
    await new Promise((r) => setTimeout(r, 80));

    // The client is still connected in standby; the next tool call starts Pigmento again.
    expect((await mcp.listTools()).tools).toHaveLength(TOOLS.length);
    const second = await mcp.callTool({ name: 'get_picture_info', arguments: {} });
    expect((second.content as { text: string }[])[0].text).toBe('get_picture_info for Antigravity');
    expect(started).toBe(2);

    await mcp.close();
    expect(await done).toBe(0);
  });

  it('does not launch Pigmento when canStart returns false (AI assistants turned off)', async () => {
    const pipe = testPipe();
    let started = 0;
    const c = client();
    const done = runBridge(
      pipe,
      c.io,
      () => {
        started++;
      },
      { retryMs: 30, onDemand: { version: '1.4.1', canStart: () => false } },
    );

    const { mcp, transport } = mcpClientOn(c, 'Antigravity');
    await mcp.connect(transport);
    const r = await mcp.callTool({ name: 'get_picture_info', arguments: {} });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toMatch(/turned off in Pigmento/);
    expect(started).toBe(0);

    await mcp.close();
    expect(await done).toBe(0);
  });
});
