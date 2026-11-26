import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import net from 'node:net';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  isJSONRPCErrorResponse,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type JSONRPCErrorResponse,
  type JSONRPCMessage,
  type JSONRPCRequest,
  type JSONRPCResultResponse,
} from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from './tools';

/**
 * The bridge an MCP client talks to: a client starts `Pigmento.exe --mcp`, which opens no window
 * and passes the client's messages (MCP over stdio) to the Pigmento that's running, over a named
 * pipe, and its answers back.
 *
 * With `onDemand` set (the default), if Pigmento isn't running yet when the AI app starts, the
 * bridge answers discovery and lifecycle messages (`initialize`, `tools/list`, `resources/list`,
 * `ping`) itself in standby and only launches Pigmento once the AI actually calls a tool or reads
 * a resource. With `onDemand` off, Pigmento is started immediately on connect.
 */

/** The switch MCP clients start Pigmento with. */
export const MCP_SWITCH = '--mcp';

/**
 * The named pipe the running Pigmento listens on for assistants: one per profile, so one per
 * Windows user (and per test profile). Only that user's programs can open it for writing.
 */
export function mcpPipeName(userData: string): string {
  const id = createHash('sha256').update(userData.toLowerCase()).digest('hex').slice(0, 16);
  return `\\\\.\\pipe\\pigmento-mcp-${id}`;
}

/** Where the bridge reads the client's messages and writes the answers. */
export interface BridgeIo {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** Says what went wrong, for the client's log (stderr). */
  error(message: string): void;
}

export interface OnDemandOptions {
  /** Pigmento version reported during standby initialize. */
  version: string;
  /** Checked before launching Pigmento on demand (return false if AI assistants are turned off). */
  canStart?: () => boolean | Promise<boolean>;
}

export interface BridgeOptions {
  /** How long to wait for Pigmento to start listening, in ms. */
  waitMs: number;
  /** How often to try again while it starts, in ms. */
  retryMs: number;
  /** Stay in standby when Pigmento is closed and only launch it on a tool call or resource read. */
  onDemand?: OnDemandOptions;
}

const DEFAULTS = { waitMs: 30_000, retryMs: 200 };
const SYNC_INIT_ID = '__pigmento_bridge_init__';

/** A connection to the pipe, or null when nothing is listening there (yet). */
function connect(pipe: string): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const s = net.connect(pipe);
    s.once('connect', () => {
      s.removeAllListeners('error');
      resolve(s);
    });
    s.once('error', () => resolve(null));
  });
}

function isResponse(m: JSONRPCMessage): m is JSONRPCResultResponse | JSONRPCErrorResponse {
  return isJSONRPCResultResponse(m) || isJSONRPCErrorResponse(m);
}

function writeMsg(out: NodeJS.WritableStream, msg: JSONRPCMessage): void {
  out.write(serializeMessage(msg));
}

/**
 * Connect the client to the running Pigmento (starting it with `start` when nothing listens on the
 * pipe, or staying in standby until a tool/resource is used when `options.onDemand` is set) and
 * pass messages both ways until the conversation ends. Resolves with the exit code: 0 on normal
 * close, 1 when Pigmento couldn't be reached.
 */
export async function runBridge(pipe: string, io: BridgeIo, start: () => void, options: Partial<BridgeOptions> = {}): Promise<number> {
  const waitMs = options.waitMs ?? DEFAULTS.waitMs;
  const retryMs = options.retryMs ?? DEFAULTS.retryMs;
  if (options.onDemand) return runOnDemandBridge(pipe, io, start, waitMs, retryMs, options.onDemand);

  let socket = await connect(pipe);
  if (!socket) {
    try {
      start();
    } catch (err) {
      io.error(`Pigmento couldn't be started: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    const until = Date.now() + waitMs;
    while (!socket && Date.now() < until) {
      await new Promise((r) => setTimeout(r, retryMs));
      socket = await connect(pipe);
    }
  }
  if (!socket) {
    io.error('Pigmento didn’t start listening for AI assistants. Is "Allow AI assistants" turned off in Settings?');
    return 1;
  }
  const s = socket;
  return new Promise((resolve) => {
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      resolve(code);
    };
    io.input.pipe(s);
    s.pipe(io.output, { end: false });
    // The client went away: tell Pigmento this conversation is over.
    io.input.on('end', () => s.end());
    io.input.on('error', () => s.end());
    s.on('close', () => finish(0));
    s.on('error', (err) => {
      io.error(`The connection to Pigmento broke: ${err.message}`);
      finish(1);
    });
  });
}

/**
 * Standby MCP bridge: connects immediately if Pigmento is already open, otherwise answers
 * discovery/lifecycle requests locally without launching Pigmento until a tool call or resource
 * read arrives. Also returns cleanly to standby if Pigmento is closed mid-session, reconnecting
 * on the next tool call.
 */
async function runOnDemandBridge(
  pipe: string,
  io: BridgeIo,
  start: () => void,
  waitMs: number,
  retryMs: number,
  onDemand: OnDemandOptions,
): Promise<number> {
  let ended = false;
  let socket: net.Socket | null = null;
  let activeSocket: net.Socket | null = null;
  let connecting: Promise<net.Socket> | null = null;
  let initReq: JSONRPCRequest | null = null;
  let initializedNotif: JSONRPCMessage | null = null;
  let initWaiter: { resolve: () => void; reject: (err: Error) => void } | null = null;
  const pending = new Set<string | number>();

  const standby = createMcpServer(onDemand.version, {
    callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'Pigmento isn’t connected.' }] }),
    readResource: async () => {
      throw new Error('Pigmento isn’t connected.');
    },
  });
  const standbyTransport: Transport = {
    async start() {},
    async close() {},
    async send(message) {
      if (!ended) writeMsg(io.output, message);
    },
  };
  await standby.connect(standbyTransport);

  const failPending = (reason: string): void => {
    for (const id of pending) {
      if (!ended) writeMsg(io.output, { jsonrpc: '2.0', id, error: { code: -32000, message: reason } });
    }
    pending.clear();
  };

  const attachSocket = (s: net.Socket): void => {
    const sockBuf = new ReadBuffer();
    s.on('data', (chunk: Buffer) => {
      sockBuf.append(chunk);
      for (;;) {
        let msg: JSONRPCMessage | null;
        try {
          msg = sockBuf.readMessage();
        } catch (err) {
          io.error(`Bad message from Pigmento: ${err instanceof Error ? err.message : String(err)}`);
          break;
        }
        if (!msg) break;
        if (isResponse(msg) && msg.id === SYNC_INIT_ID) {
          const w = initWaiter;
          initWaiter = null;
          if (isJSONRPCErrorResponse(msg)) w?.reject(new Error(msg.error.message));
          else w?.resolve();
          continue;
        }
        if (isResponse(msg) && msg.id !== undefined) pending.delete(msg.id);
        if (!ended) writeMsg(io.output, msg);
      }
    });
    const drop = (reason: string) => {
      if (socket === s) socket = null;
      if (activeSocket === s) activeSocket = null;
      if (initWaiter) {
        const w = initWaiter;
        initWaiter = null;
        w.reject(new Error(reason));
      }
      failPending(reason);
    };
    s.on('close', () => drop('Pigmento closed before answering.'));
    s.on('error', (err) => drop(`The connection to Pigmento broke: ${err.message}`));
  };

  const ensureConnected = (): Promise<net.Socket> => {
    if (socket) return Promise.resolve(socket);
    if (connecting) return connecting;
    connecting = (async () => {
      let s = await connect(pipe);
      if (!s) {
        if (onDemand.canStart && !(await onDemand.canStart())) {
          throw new Error('AI assistants are turned off in Pigmento (Settings → AI assistants).');
        }
        try {
          start();
        } catch (err) {
          throw new Error(`Pigmento couldn't be started: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
        const until = Date.now() + waitMs;
        while (!s && !ended && Date.now() < until) {
          await new Promise((r) => setTimeout(r, retryMs));
          if (ended) break;
          s = await connect(pipe);
        }
        if (!s) {
          throw new Error('Pigmento didn’t start listening for AI assistants. Is "Allow AI assistants" turned off in Settings?');
        }
      }
      activeSocket = s;
      attachSocket(s);
      // Replay the client's initialize handshake so Pigmento knows who connected.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (initWaiter) {
            initWaiter = null;
            s.destroy();
            reject(new Error('Pigmento didn’t answer the MCP handshake in time.'));
          }
        }, waitMs);
        initWaiter = {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          },
        };
        const params = initReq?.params ?? { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'An AI assistant', version: '1.0.0' } };
        writeMsg(s, { jsonrpc: '2.0', id: SYNC_INIT_ID, method: 'initialize', params });
      });
      writeMsg(s, initializedNotif ?? { jsonrpc: '2.0', method: 'notifications/initialized' });
      socket = s;
      return s;
    })().finally(() => {
      connecting = null;
    });
    return connecting;
  };

  // If Pigmento is already open, attach right away so the title bar shows who connected.
  const existing = await connect(pipe);
  if (existing) {
    activeSocket = existing;
    attachSocket(existing);
    socket = existing;
  }

  const needsApp = (m: JSONRPCMessage): m is JSONRPCRequest => isJSONRPCRequest(m) && (m.method === 'tools/call' || m.method === 'resources/read');

  const handleMessage = (msg: JSONRPCMessage): void => {
    if (isJSONRPCRequest(msg) && msg.method === 'initialize') initReq = msg;
    if (isJSONRPCNotification(msg) && msg.method === 'notifications/initialized') initializedNotif = msg;

    if (needsApp(msg)) {
      void ensureConnected().then(
        (s) => {
          if (ended) return;
          pending.add(msg.id);
          writeMsg(s, msg);
        },
        (err: unknown) => {
          if (ended) return;
          const message = err instanceof Error ? err.message : String(err);
          if (msg.method === 'tools/call') {
            writeMsg(io.output, { jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: message }] } });
          } else {
            writeMsg(io.output, { jsonrpc: '2.0', id: msg.id, error: { code: -32000, message } });
          }
        },
      );
      return;
    }

    if (socket) {
      if (isJSONRPCRequest(msg)) pending.add(msg.id);
      writeMsg(socket, msg);
      return;
    }

    if (connecting && isJSONRPCNotification(msg) && msg.method === 'notifications/cancelled') {
      void connecting.then(
        (s) => {
          if (!ended) writeMsg(s, msg);
        },
        () => undefined,
      );
      return;
    }

    standbyTransport.onmessage?.(msg);
  };

  return new Promise((resolve) => {
    const finish = () => {
      if (ended) return;
      ended = true;
      activeSocket?.end();
      if (initWaiter) activeSocket?.destroy();
      activeSocket = null;
      socket = null;
      void standby.close().finally(() => resolve(0));
    };
    const inBuf = new ReadBuffer();
    io.input.on('data', (chunk: Buffer | string) => {
      inBuf.append(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      for (;;) {
        let msg: JSONRPCMessage | null;
        try {
          msg = inBuf.readMessage();
        } catch (err) {
          io.error(`Bad MCP message from client: ${err instanceof Error ? err.message : String(err)}`);
          break;
        }
        if (!msg) break;
        handleMessage(msg);
      }
    });
    io.input.on('end', finish);
    io.input.on('error', finish);
  });
}

/**
 * The client's messages: stdin read straight from its handle. (Electron gives a windowed app's main
 * process an empty process.stdin on Windows, but the handle the client passed is there.)
 */
export function stdinStream(): NodeJS.ReadableStream {
  try {
    return new net.Socket({ fd: 0, readable: true, writable: false });
  } catch {
    return createReadStream('', { fd: 0 });
  }
}
