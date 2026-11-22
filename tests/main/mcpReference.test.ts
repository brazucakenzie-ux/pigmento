import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mcpReference } from '../../src/main/mcp/reference';

const FILE = path.resolve(__dirname, '../../docs/mcp.md');

describe('the tool reference (docs/mcp.md)', () => {
  it('says what the tools are (npm run mcp-docs writes it after a change)', () => {
    const made = mcpReference();
    if (process.env.PIGMENTO_UPDATE_MCP_DOCS === '1') writeFileSync(FILE, made);
    expect(readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n')).toBe(made);
  });
});
