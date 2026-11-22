import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import net from 'node:net';

/**
 * The bridge an MCP client talks to: a client starts `Pigmento.exe --mcp`, which opens no window
 * and passes the client's messages (MCP over stdio) to the Pigmento that's running, over a named
 * pipe, and its answers back. If Pigmento isn't running it's started first. The bridge doesn't
 * read the messages: the server in the app (see server.ts) does.
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

export interface BridgeOptions {
  /** How long to wait for Pigmento to start listening, in ms. */
  waitMs: number;
  /** How often to try again while it starts, in ms. */
  retryMs: number;
}

const DEFAULTS: BridgeOptions = { waitMs: 30_000, retryMs: 200 };

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

/**
 * Connect the client to the running Pigmento (starting it with `start` when nothing listens on the
 * pipe) and pass bytes both ways until either side closes. Resolves with the exit code: 0 when the
 * conversation ends, 1 when Pigmento couldn't be reached.
 */
export async function runBridge(pipe: string, io: BridgeIo, start: () => void, options: Partial<BridgeOptions> = {}): Promise<number> {
  const { waitMs, retryMs } = { ...DEFAULTS, ...options };
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
