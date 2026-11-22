import { describe, expect, it } from 'vitest';
import { clientSnippet, httpAddress, MCP_CLIENTS, type McpCommand } from '@shared/mcpSetup';
import { defaultSettings, parseSettings } from '@shared/settings';

const PACKAGED: McpCommand = { command: 'C:\\Users\\Ana Lima\\AppData\\Local\\Programs\\Pigmento\\Pigmento.exe', args: ['--mcp'] };
const URL = httpAddress(39217, 'ab12');

describe('setting up an MCP client', () => {
  it('gives each JSON client a valid entry that starts Pigmento --mcp', () => {
    const desktop = JSON.parse(clientSnippet('claudeDesktop', PACKAGED).text) as { mcpServers: Record<string, unknown> };
    expect(desktop.mcpServers.pigmento).toEqual({ command: PACKAGED.command, args: ['--mcp'] });
    const vscode = JSON.parse(clientSnippet('vscode', PACKAGED).text) as { servers: Record<string, unknown> };
    expect(vscode.servers.pigmento).toEqual({ type: 'stdio', command: PACKAGED.command, args: ['--mcp'] });
    const cursor = JSON.parse(clientSnippet('cursor', PACKAGED).text) as { mcpServers: Record<string, unknown> };
    expect(cursor.mcpServers.pigmento).toEqual({ command: PACKAGED.command, args: ['--mcp'] });
  });

  it('quotes a path with spaces on a command line', () => {
    expect(clientSnippet('claudeCode', PACKAGED)).toEqual({ language: 'shell', text: `claude mcp add pigmento -- "${PACKAGED.command}" --mcp` });
    expect(clientSnippet('other', PACKAGED).text).toBe(`Command: "${PACKAGED.command}"\nArguments: --mcp`);
    // In development, Electron starts the app's folder.
    const dev: McpCommand = { command: 'C:\\dev\\electron.exe', args: ['C:\\dev\\pigmento', '--mcp'] };
    expect(clientSnippet('claudeCode', dev).text).toBe('claude mcp add pigmento -- C:\\dev\\electron.exe C:\\dev\\pigmento --mcp');
  });

  it('uses the local HTTP address for clients that take one, but not Claude Desktop', () => {
    expect(URL).toBe('http://127.0.0.1:39217/mcp/ab12');
    expect(clientSnippet('claudeCode', PACKAGED, URL).text).toBe(`claude mcp add --transport http pigmento ${URL}`);
    expect(JSON.parse(clientSnippet('vscode', PACKAGED, URL).text)).toEqual({ servers: { pigmento: { type: 'http', url: URL } } });
    expect(JSON.parse(clientSnippet('cursor', PACKAGED, URL).text)).toEqual({ mcpServers: { pigmento: { url: URL } } });
    expect(clientSnippet('other', PACKAGED, URL).text).toContain(`Or by URL (Streamable HTTP): ${URL}`);
    expect(JSON.parse(clientSnippet('claudeDesktop', PACKAGED, URL).text).mcpServers.pigmento.command).toBe(PACKAGED.command);
    for (const c of MCP_CLIENTS) expect(clientSnippet(c, PACKAGED).text.length).toBeGreaterThan(10);
  });
});

describe('the AI assistants settings', () => {
  it('are very free by default: on, everything allowed, files anywhere, drawing you can follow, no HTTP', () => {
    expect(defaultSettings().assistants).toEqual({ enabled: true, look: 'allow', edit: 'allow', files: 'allow', folder: null, pictures: 'allow', settings: 'allow', pace: 'watch', http: false, httpPort: 39217, httpToken: '' });
  });

  it('keep what’s valid and fall back on the rest', () => {
    const s = parseSettings({ assistants: { enabled: false, files: 'ask', folder: 'D:\\Art', pace: 'instant', http: true, httpPort: 40000, httpToken: 'abc123' } });
    expect(s.assistants).toMatchObject({ enabled: false, files: 'ask', folder: 'D:\\Art', pace: 'instant', http: true, httpPort: 40000, httpToken: 'abc123', look: 'allow' });
    // A bad value anywhere in the section: the section's defaults (other settings kept).
    for (const bad of [{ look: 'maybe' }, { httpPort: 80 }, { httpToken: 'not hex!' }, { pace: 'fast' }]) {
      const p = parseSettings({ assistants: bad, ui: { scale: 1.5 } });
      expect(p.assistants).toEqual(defaultSettings().assistants);
      expect(p.ui.scale).toBe(1.5);
    }
  });
});
