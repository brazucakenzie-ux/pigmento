import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { mcpPipeName, runBridge } from '../../src/main/mcp/bridge';

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
