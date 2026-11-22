// Write docs/mcp.md from the tools AI assistants call (src/main/mcp), through its unit test.
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['vitest', 'run', 'tests/main/mcpReference.test.ts'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PIGMENTO_UPDATE_MCP_DOCS: '1' },
});
process.exit(r.status ?? 1);
