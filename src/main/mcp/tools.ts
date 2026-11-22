import { BrowserWindow } from 'electron';
import { z } from 'zod';
import type { AssistantResult } from '@shared/ipc';

/**
 * The tools AI assistants can call. Each is one kind of thing a person does in Pigmento, checked
 * against the permission for that kind (Settings → AI assistants). Most run in a window, on the
 * picture there; a few are answered here in the main process.
 */

/** The kinds of things an assistant does, each with its own permission. */
export type AssistantKind = 'look' | 'edit' | 'files' | 'pictures' | 'settings';

/** A window: its id (from list_windows) and title. */
export interface WindowInfo {
  id: number;
  title: string;
  /** It's the one you're working in. */
  current: boolean;
}

export interface ToolContext {
  /** Every open Pigmento window. */
  windows(): WindowInfo[];
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  kind: AssistantKind;
  /** Its arguments (a window tool also takes an optional `window`). */
  input: z.ZodRawShape;
  /** It only reads (it never changes a picture, a file or a setting). */
  readOnly: boolean;
  /** Answered in the main process (otherwise the window does it). */
  main?: (ctx: ToolContext, args: Record<string, unknown>) => AssistantResult;
}

/** The optional argument every window tool takes: which window (from list_windows; the one you're working in if left out). */
export const WINDOW_ARG = {
  window: z.number().int().positive().optional().describe('Which Pigmento window (an id from list_windows). Leave it out for the window the user is working in.'),
};

export const TOOLS: readonly ToolDef[] = [
  {
    name: 'list_windows',
    title: 'List windows',
    description: 'The Pigmento windows that are open, each with its id and title (the picture in it), and which one the user is working in.',
    kind: 'look',
    input: {},
    readOnly: true,
    main: (ctx) => {
      const windows = ctx.windows();
      return { text: windows.map((w) => `${w.id}: ${w.title}${w.current ? ' (the one being worked in)' : ''}`).join('\n') || 'No windows are open.', data: { windows } };
    },
  },
  {
    name: 'get_picture_info',
    title: 'Picture info',
    description: 'The picture in a window: its size in pixels, its layers (top first: id, name, kind, visible, opacity, blend mode, which is active), whether it has unsaved changes and its file, the selection, and the animation (frame shown, length, frames a second, pieces).',
    kind: 'look',
    input: {},
    readOnly: true,
  },
];

/** The window a tool acts on: the one named, or the one being worked in (the focused or the last focused). */
export function windowFor(id: number | undefined, lastFocused: BrowserWindow | null): BrowserWindow {
  if (id !== undefined) {
    const w = BrowserWindow.fromId(id);
    if (!w || w.isDestroyed()) throw new Error(`There's no Pigmento window ${id}. list_windows says which are open.`);
    return w;
  }
  const w = BrowserWindow.getFocusedWindow() ?? (lastFocused && !lastFocused.isDestroyed() ? lastFocused : null) ?? BrowserWindow.getAllWindows()[0];
  if (!w) throw new Error('No Pigmento window is open.');
  return w;
}
