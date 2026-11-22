import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { app, BrowserWindow, ipcMain } from 'electron';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { ASSISTANT_ASK as ASK, IPC, type AssistantCall, type AssistantReply, type AssistantResult, type AssistantsState } from '@shared/ipc';
import type { Settings } from '@shared/settings';
import { getSettings, updateSettings } from '../settings';
import { AssistantsBook } from './book';
import { RESOURCES, TOOLS, WINDOW_ARG, windowFor, type ResourceDef, type ToolDef } from './tools';

/**
 * The MCP server inside Pigmento: AI assistants connect over the named pipe (through the
 * `--mcp` bridge) or, when it's turned on, over Streamable HTTP on 127.0.0.1. Each connection
 * is a session of its own; tool calls go to the window being worked in (or the one named) and
 * come back as that window answers them.
 */

type AssistantSettings = Settings['assistants'];

/** What assistants are told about Pigmento when they connect. */
const INSTRUCTIONS = [
  'Pigmento is a painting and animation app for Windows. Its tools act on the picture in the window the user is working in, while they watch, or in the window you name (an id from list_windows).',
  'Positions and sizes are in picture pixels, from the top-left corner, and animation frames are numbered from 1, as in the timeline. Start with get_picture_info to see the picture you are working on, and use get_picture_image to look at it and check your work.',
  'Every change you make is one undo step the user can take back.',
].join(' ');

/** How long a window has to answer a call before the assistant is told it didn't. */
const CALL_TIMEOUT_MS = 120_000;

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
    const mcp = new McpServer({ name: 'pigmento', title: 'Pigmento', version: this.version }, { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS });
    const client = () => mcp.server.getClientVersion()?.title ?? mcp.server.getClientVersion()?.name ?? 'An AI assistant';
    // It shows as connected once it says who it is.
    mcp.server.oninitialized = () => this.book.named(session, client());
    for (const tool of TOOLS) {
      mcp.registerTool(
        tool.name,
        { title: tool.title, description: tool.description, inputSchema: tool.main ? tool.input : { ...tool.input, ...WINDOW_ARG }, annotations: { readOnlyHint: tool.readOnly, openWorldHint: false } },
        async (args: Record<string, unknown>) => this.call(tool, args, client()),
      );
    }
    for (const res of RESOURCES) {
      const tool = TOOLS.find((d) => d.name === res.tool);
      if (!tool) throw new Error(`The resource ${res.uri} has no tool ${res.tool}`);
      mcp.registerResource(res.name, res.uri, { title: res.title, description: res.description, mimeType: res.mimeType }, (uri) => this.read(uri, res, tool, client()));
    }
    return mcp;
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
    if (s[tool.kind] === 'deny') return refuse(`Pigmento doesn’t let AI assistants ${KIND_WORDS[tool.kind]} (Settings → AI assistants).`);
    try {
      const { window: id, ...rest } = args as { window?: number } & Record<string, unknown>;
      const win = windowFor(tool.main ? undefined : id, this.lastFocused);
      const call = { id: 0, tool: tool.name, args: rest, client, title: tool.title };
      if (s[tool.kind] === 'ask') {
        const answer = await this.callWindow(win, { ...call, tool: ASK, ask: KIND_WORDS[tool.kind] });
        if (!answer.ok) return answer;
      }
      if (tool.main) return { ok: true, result: tool.main({ windows: () => this.windows() }, args) };
      return await this.callWindow(win, call);
    } catch (err) {
      return refuse(err instanceof Error ? err.message : String(err));
    }
  }

  private windows() {
    const current = BrowserWindow.getFocusedWindow() ?? this.lastFocused;
    return BrowserWindow.getAllWindows().map((w) => ({ id: w.id, title: w.getTitle(), current: w === current }));
  }

  /** Ask a window to carry out a call, and wait for its answer (or for it to close). */
  private callWindow(win: BrowserWindow, call: AssistantCall): Promise<AssistantReply> {
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
