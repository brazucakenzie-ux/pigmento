import { describe, expect, it } from 'vitest';
import { RESOURCES, TOOLS } from '../../src/main/mcp/tools';

describe('the tools AI assistants call', () => {
  it('have names of their own', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it('say whether they only look, and which change something', () => {
    for (const t of TOOLS) expect(t.readOnly, t.name).toBe(t.kind === 'look');
  });

  it('read every resource through a tool there is', () => {
    for (const r of RESOURCES) expect(TOOLS.map((t) => t.name)).toContain(r.tool);
  });
});
