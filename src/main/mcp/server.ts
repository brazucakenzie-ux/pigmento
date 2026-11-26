import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { app, BrowserWindow, ipcMain, type WebContents } from 'electron';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { ASSISTANT_ASK as ASK, IPC, type AssistantCall, type AssistantReply, type AssistantResult, type AssistantsState } from '@shared/ipc';
import { getSettings, updateSettings } from '../settings';
import { allowCloseAndClose, createWindow, markWindowUsed } from '../windows';
import { AssistantsBook } from './book';
import { createMcpServer, windowFor, type ResourceDef } from './tools';
import type { AssistantKind, AssistantSettings, ToolContext, ToolDef, WindowPicture } from './types';

/**
 * The MCP server inside Pigmento: AI assistants connect over the named pipe (through the
 * `--mcp` bridge) or, when it's turned on, over Streamable HTTP on 127.0.0.1. Each connection
 * is a session of its own; tool calls go to the window being worked in (or the one named) and
 * come back as that window answers them.
 */

/** How long a window has to answer a call before the assistant is told it didn't. */
const CALL_TIMEOUT_MS = 120_000;
/** How long a new (or reloading) window has to get ready for calls. */
const READY_TIMEOUT_MS = 30_000;
/** The window's own part of a call: what main needs to know about its picture. */
const PICTURE_STATE = 'pigmento.picture';

/** A tool's answer, as MCP gives it to the assistant. */
function toResult(r: AssistantResult): CallToolResult {
  const content: CallToolResult['content'] = [];
  if (r.text) content.push({ type: 'text', text: r.text });
  if (r.data !== undefined) content.push({ type: 'text', text: JSON.stringify(r.data, null, 2) });
  for (const im of r.images ?? []) content.push({ type: 'image', data: im.base64, mimeType: im.mimeType });
  if (!content.length) content.push({ type: 'text', text: 'Done.' });
  const structured = r.data !== null && typeof r.data === 'object' && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : undefined;
  return { content, ...(structured ? { structuredContent: structured } : {}) };
}

const failure = (message: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text: message }] });


/** Words for what a kind of permission covers (for refusals). */
const KIND_WORDS: Record<ToolDef['kind'], string> = {
  look: 'look at pictures',
  edit: 'draw and edit',
  files: 'open, save or export files',
  pictures: 'make, close or switch pictures',
  settings: 'change Pigmento’s settings',
};

export class AssistantHost {
  private pipeServer: net.Server | null = null;
  private httpServer: http.Server | null = null;
  private httpAt = '';
  private readonly pending = new Map<number, { resolve: (r: AssistantReply) => void; win: BrowserWindow }>();
  private nextId = 1;
  private lastFocused: BrowserWindow | null = null;
  /** Windows whose page is listening for calls, and calls waiting for one to be. */
  private readonly ready = new WeakSet<WebContents>();
  private readonly waiting = new Map<WebContents, (() => void)[]>();
  /** Who's connected, whether they're stopped, and what they've done (every window shows it). */
  private readonly book = new AssistantsBook((s: AssistantsState) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.evAssistantsState, s);
  });

  constructor(
    private readonly pipe: string,
    private readonly version: string,
  ) {
    app.on('browser-window-focus', (_e, w) => (this.lastFocused = w));
    ipcMain.handle(IPC.assistantsState, () => this.book.state());
    ipcMain.on(IPC.assistantReady, (e) => {
      this.ready.add(e.sender);
      for (const go of this.waiting.get(e.sender) ?? []) go();
      this.waiting.delete(e.sender);
    });
    // A page that reloads listens again once it's loaded.
    app.on('web-contents-created', (_e, wc) => wc.on('did-start-loading', () => this.ready.delete(wc)));
    ipcMain.on(IPC.assistantsPause, (_e, paused: unknown) => this.book.setPaused(paused === true));
    ipcMain.on(IPC.assistantReply, (e, id: unknown, reply: unknown) => {
      const p = typeof id === 'number' ? this.pending.get(id) : undefined;
      if (!p || p.win.webContents !== e.sender) return;
      this.pending.delete(id as number);
      p.resolve(isReply(reply) ? reply : { ok: false, error: 'The window gave an answer Pigmento couldn’t read.' });
    });
  }

  /** Listen (or stop) as the settings say: the pipe while assistants are allowed, HTTP while it's turned on too. */
  apply(s: AssistantSettings): void {
    if (s.enabled && !this.pipeServer) this.listenPipe();
    if (!s.enabled && this.pipeServer) {
      this.pipeServer.close();
      this.pipeServer = null;
    }
    const at = s.enabled && s.http ? `${s.httpPort}/${s.httpToken}` : '';
    if (at === this.httpAt) return;
    this.httpServer?.close();
    this.httpServer = null;
    this.httpAt = '';
    if (!at) return;
    if (!s.httpToken) {
      // The token in the address is made the first time it's needed.
      updateSettings({ assistants: { ...s, httpToken: randomBytes(24).toString('hex') } });
      this.apply(getSettings().assistants);
      return;
    }
    this.listenHttp(s.httpPort, s.httpToken);
    this.httpAt = at;
  }

  close(): void {
    this.pipeServer?.close();
    this.httpServer?.close();
  }

  private listenPipe(): void {
    const server = net.createServer((socket) => void this.serveSocket(socket));
    server.on('error', (err) => console.error('AI assistants: the pipe failed', err));
    server.listen(this.pipe);
    this.pipeServer = server;
  }

  private async serveSocket(socket: net.Socket): Promise<void> {
    const session = this.book.open();
    const mcp = this.makeServer(session);
    const transport = new StdioServerTransport(socket, socket);
    socket.on('close', () => {
      this.book.close(session);
      void transport.close();
    });
    socket.on('error', () => socket.destroy());
    await mcp.connect(transport);
  }

  private listenHttp(port: number, token: string): void {
    const sessions = new Map<string, StreamableHTTPServerTransport>();
    const server = http.createServer((req, res) => {
      // This computer only, with the token, and never from a web page (a browser sends an Origin).
      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      if (req.headers.origin !== undefined || path !== `/mcp/${token}`) {
        res.writeHead(req.headers.origin !== undefined ? 403 : 404).end();
        return;
      }
      void (async () => {
        const id = req.headers['mcp-session-id'];
        let transport = typeof id === 'string' ? sessions.get(id) : undefined;
        if (!transport) {
          const session = this.book.open();
          const t = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => void sessions.set(sid, t),
            enableDnsRebindingProtection: true,
            allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
          });
          t.onclose = () => {
            this.book.close(session);
            if (t.sessionId) sessions.delete(t.sessionId);
          };
          await this.makeServer(session).connect(t);
          transport = t;
        }
        await transport.handleRequest(req, res);
      })().catch((err: unknown) => {
        console.error('AI assistants: an HTTP request failed', err);
        if (!res.headersSent) res.writeHead(500).end();
      });
    });
    server.on('error', (err) => console.error(`AI assistants: port ${port} couldn't be used`, err));
    server.listen(port, '127.0.0.1');
    this.httpServer = server;
  }

  /** An MCP server for one conversation (session: its place in the book), with every tool. */
  private makeServer(session: number): McpServer {
    return createMcpServer(this.version, {
      onInitialized: (client) => this.book.named(session, client),
      callTool: (tool, args, client) => this.call(tool, args, client),
      readResource: (uri, res, tool, client) => this.read(uri, res, tool, client),
    });
  }

  /** Carry out one call, noting it in the book. */
  private async call(tool: ToolDef, args: Record<string, unknown>, client: string): Promise<CallToolResult> {
    const reply = await this.carryOut(tool, args, client);
    this.book.record(client, tool.title, reply.ok, reply.ok ? undefined : reply.error);
    return reply.ok ? toResult(reply.result) : failure(reply.error);
  }

  /** Read a resource through its tool (the same permission, noted in the book the same way). */
  private async read(uri: URL, res: ResourceDef, tool: ToolDef, client: string): Promise<ReadResourceResult> {
    const reply = await this.carryOut(tool, {}, client);
    this.book.record(client, tool.title, reply.ok, reply.ok ? undefined : reply.error);
    if (!reply.ok) throw new Error(reply.error);
    const image = reply.result.images?.[0];
    if (res.mimeType === 'image/png') {
      if (!image) throw new Error('The window gave no image.');
      return { contents: [{ uri: uri.href, mimeType: image.mimeType, blob: image.base64 }] };
    }
    return { contents: [{ uri: uri.href, mimeType: res.mimeType, text: JSON.stringify(reply.result.data ?? null, null, 2) }] };
  }

  /** One call: unless assistants are stopped or its kind isn't allowed (asking you first, if that's the setting), here or in its window. */
  private async carryOut(tool: ToolDef, args: Record<string, unknown>, client: string): Promise<AssistantReply> {
    const s = getSettings().assistants;
    const refuse = (error: string): AssistantReply => ({ ok: false, error });
    if (!s.enabled) return refuse('AI assistants are turned off in Pigmento (Settings → AI assistants).');
    if (this.book.paused) return refuse('The user has stopped AI assistants in Pigmento for now. Try again once they let you go on.');
    try {
      const { window: id, ...rest } = args as { window?: number } & Record<string, unknown>;
      const win = windowFor(tool.noWindow ? undefined : id, this.lastFocused);
      const call = { id: 0, tool: tool.name, args: rest, client, title: tool.title, pace: s.pace };
      // Each kind is checked once a call (asking, if that's the setting).
      const permitted = new Set<AssistantKind>();
      const permit = async (kind: AssistantKind): Promise<void> => {
        if (permitted.has(kind)) return;
        const now = getSettings().assistants;
        if (now[kind] === 'deny') throw new Error(`Pigmento doesn’t let AI assistants ${KIND_WORDS[kind]} (Settings → AI assistants).`);
        if (now[kind] === 'ask') {
          const answer = await this.callWindow(win, { ...call, tool: ASK, ask: KIND_WORDS[kind] });
          if (!answer.ok) throw new Error(answer.error);
        }
        permitted.add(kind);
      };
      await permit(tool.kind);
      if (tool.main) return { ok: true, result: await tool.main(this.context(win, s, permit), rest) };
      return await this.callWindow(win, call);
    } catch (err) {
      return refuse(err instanceof Error ? err.message : String(err));
    }
  }

  /** What a tool answered here can do. */
  private context(win: BrowserWindow, settings: AssistantSettings, permit: (kind: AssistantKind) => Promise<void>): ToolContext {
    const call = async (target: BrowserWindow, tool: string, args: Record<string, unknown>) => {
      const reply = await this.callWindow(target, { id: 0, tool, args, client: '', title: '', pace: settings.pace });
      if (!reply.ok) throw new Error(reply.error);
      return reply.result;
    };
    return {
      win,
      settings,
      windows: () => this.windows(),
      call,
      permit,
      picture: async (target) => (await call(target, PICTURE_STATE, {})).data as WindowPicture,
      newWindow: async () => {
        const w = createWindow(null);
        markWindowUsed(w);
        this.lastFocused = w;
        await this.whenReady(w);
        return w;
      },
      close: (target) => allowCloseAndClose(target),
      focus: (target) => {
        if (target.isMinimized()) target.restore();
        target.show();
        target.focus();
        this.lastFocused = target;
      },
    };
  }

  /** Resolves once a window's page listens for calls. */
  private whenReady(win: BrowserWindow): Promise<void> {
    const wc = win.webContents;
    if (this.ready.has(wc)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The Pigmento window didn’t get ready in time.')), READY_TIMEOUT_MS);
      const list = this.waiting.get(wc) ?? [];
      list.push(() => {
        clearTimeout(timer);
        resolve();
      });
      this.waiting.set(wc, list);
    });
  }

  private windows() {
    const current = BrowserWindow.getFocusedWindow() ?? this.lastFocused;
    return BrowserWindow.getAllWindows().map((w) => ({ id: w.id, title: w.getTitle(), current: w === current }));
  }

  /** Ask a window to carry out a call, and wait for its answer (or for it to close). */
  private async callWindow(win: BrowserWindow, call: AssistantCall): Promise<AssistantReply> {
    try {
      await this.whenReady(win);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (win.isDestroyed()) return { ok: false, error: 'The window was closed.' };
    const id = this.nextId++;
    return new Promise((resolve) => {
      const done = (r: AssistantReply) => {
        clearTimeout(timer);
        win.removeListener('closed', closed);
        this.pending.delete(id);
        resolve(r);
      };
      const closed = () => done({ ok: false, error: 'The window was closed before it finished.' });
      const timer = setTimeout(() => done({ ok: false, error: 'The window didn’t answer in time.' }), CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve: done, win });
      win.once('closed', closed);
      win.webContents.send(IPC.evAssistantCall, { ...call, id });
    });
  }
}

function isReply(r: unknown): r is AssistantReply {
  if (typeof r !== 'object' || r === null) return false;
  const v = r as { ok?: unknown; error?: unknown; result?: unknown };
  return v.ok === true ? typeof v.result === 'object' && v.result !== null : v.ok === false && typeof v.error === 'string';
}
