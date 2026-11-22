import { describe, expect, it } from 'vitest';
import { BLEND_MODES as ENGINE_BLEND_MODES } from '../../src/renderer/src/engine/doc/Document';
import { en } from '../../src/renderer/src/i18n/en';
import { BLEND_MODES } from '../../src/main/mcp/edit';
import { RESOURCES, TOOLS } from '../../src/main/mcp/tools';

describe('the tools AI assistants call', () => {
  it('have names of their own', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it('each change the picture as an undo step with its own name', () => {
    // Window tools that change something (main's own tools open, save and close instead).
    const changes = TOOLS.filter((t) => !t.readOnly && !t.main);
    expect(changes.length).toBeGreaterThan(5);
    for (const t of changes) expect(en[`assistant.step.${t.name}` as keyof typeof en], t.name).toMatch(/^Assistant: /);
  });

  it('offer the blend modes Pigmento has', () => {
    expect([...BLEND_MODES]).toEqual(ENGINE_BLEND_MODES);
  });

  it('read every resource through a tool there is', () => {
    for (const r of RESOURCES) expect(TOOLS.map((t) => t.name)).toContain(r.tool);
  });
});
