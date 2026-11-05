/**
 * Loads every built-in tool. Each file in this folder registers itself with the ToolRegistry
 * on import, so adding a tool is just adding a file here — no other code changes.
 */
import.meta.glob(['./*.ts', '!./index.ts'], { eager: true });
