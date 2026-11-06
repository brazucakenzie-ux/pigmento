import type { Tool, ToolGroup } from './Tool';

/**
 * Registry of tools. Built-in tools register themselves from `tools/builtin/*.ts`, which are
 * loaded with `import.meta.glob`, so adding a tool means adding one file.
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.id)) throw new Error(`Tool "${tool.id}" is already registered`);
    this.tools.set(tool.id, tool);
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  all(): Tool[] {
    return [...this.tools.values()].sort((a, b) => a.order - b.order);
  }

  byGroup(group: ToolGroup): Tool[] {
    return this.all().filter((t) => t.group === group && !t.hidden);
  }

  byShortcut(key: string): Tool | undefined {
    const k = key.toLowerCase();
    return this.all().find((t) => t.shortcut?.toLowerCase() === k);
  }
}

/** Global registry used by the app. Tool modules call `registerTool` at import time. */
export const toolRegistry = new ToolRegistry();

export function registerTool(tool: Tool): Tool {
  toolRegistry.register(tool);
  return tool;
}
