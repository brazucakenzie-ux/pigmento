/**
 * How to add Pigmento to an MCP client: what to paste into its settings, for the clients most
 * people use and any other. Every client starts Pigmento the same way (`Pigmento.exe --mcp`);
 * clients that connect by URL can use the local HTTP address instead, when it's on.
 */

/** The command line an MCP client runs to reach Pigmento. */
export interface McpCommand {
  command: string;
  args: string[];
}

export const MCP_CLIENTS = ['claudeDesktop', 'claudeCode', 'vscode', 'cursor', 'other'] as const;
export type McpClient = (typeof MCP_CLIENTS)[number];

/** What to paste, and whether it's JSON (for a settings file) or a command line. */
export interface McpSnippet {
  text: string;
  language: 'json' | 'shell' | 'text';
}

const SERVER_NAME = 'pigmento';

/** One argument as a Windows command line takes it (quoted when it has spaces or quotes). */
function quote(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

/**
 * What to paste into a client to add Pigmento: by its command, or by `url` (the local HTTP
 * address) when one is given and the client takes URLs.
 */
export function clientSnippet(client: McpClient, cmd: McpCommand, url: string | null = null): McpSnippet {
  const stdio = { command: cmd.command, args: cmd.args };
  switch (client) {
    case 'claudeDesktop':
      // Claude Desktop starts servers by command only.
      return { language: 'json', text: json({ mcpServers: { [SERVER_NAME]: stdio } }) };
    case 'claudeCode':
      return url
        ? { language: 'shell', text: `claude mcp add --transport http ${SERVER_NAME} ${url}` }
        : { language: 'shell', text: `claude mcp add ${SERVER_NAME} -- ${[cmd.command, ...cmd.args].map(quote).join(' ')}` };
    case 'vscode':
      return { language: 'json', text: json({ servers: { [SERVER_NAME]: url ? { type: 'http', url } : { type: 'stdio', ...stdio } } }) };
    case 'cursor':
      return { language: 'json', text: json({ mcpServers: { [SERVER_NAME]: url ? { url } : stdio } }) };
    case 'other':
      return {
        language: 'text',
        text: [`Command: ${quote(cmd.command)}`, `Arguments: ${cmd.args.map(quote).join(' ')}`, ...(url ? [`Or by URL (Streamable HTTP): ${url}`] : [])].join('\n'),
      };
  }
}

/** The local HTTP address an assistant connects to (its token keeps other programs out). */
export function httpAddress(port: number, token: string): string {
  return `http://127.0.0.1:${port}/mcp/${token}`;
}
