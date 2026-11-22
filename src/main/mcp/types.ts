import type { BrowserWindow } from 'electron';
import { z } from 'zod';
import type { AssistantResult } from '@shared/ipc';
import type { Settings } from '@shared/settings';

/** The kinds of things an assistant does, each with its own permission (Settings → AI assistants). */
export type AssistantKind = 'look' | 'edit' | 'files' | 'pictures' | 'settings';

export type AssistantSettings = Settings['assistants'];

/** A window: its id (from list_windows) and title. */
export interface WindowInfo {
  id: number;
  title: string;
  /** It's the one you're working in. */
  current: boolean;
}

/** The picture in a window, as main needs to know it. */
export interface WindowPicture {
  name: string;
  /** Its file, if it has been saved or opened. */
  path: string | null;
  /** It has changes that aren't saved. */
  dirty: boolean;
}

/** What a tool answered in the main process can do. */
export interface ToolContext {
  /** The window the call is for: the one named, or the one being worked in. */
  win: BrowserWindow;
  settings: AssistantSettings;
  /** Every open Pigmento window. */
  windows(): WindowInfo[];
  /** Have a window carry out its part of this call (an error if it can't). */
  call(win: BrowserWindow, tool: string, args: Record<string, unknown>): Promise<AssistantResult>;
  /** The picture in a window. */
  picture(win: BrowserWindow): Promise<WindowPicture>;
  /** Check another kind of permission this call needs (asking, if that's the setting). */
  permit(kind: AssistantKind): Promise<void>;
  /** A new window, once it's ready for calls (and in front: the one being worked in). */
  newWindow(): Promise<BrowserWindow>;
  /** Close a window without asking about its picture. */
  close(win: BrowserWindow): void;
  focus(win: BrowserWindow): void;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  kind: AssistantKind;
  /** Its arguments (it also takes an optional `window`, unless `noWindow`). */
  input: z.ZodRawShape;
  /** It only reads (it never changes a picture, a file or a setting). */
  readOnly: boolean;
  /** It may lose something that can't be undone (closing without saving, replacing a file). */
  destructive?: boolean;
  /** It isn't about one window (list_windows). */
  noWindow?: boolean;
  /** Answered in the main process (otherwise the window does it, under the same name). */
  main?: (ctx: ToolContext, args: Record<string, unknown>) => AssistantResult | Promise<AssistantResult>;
}

/** The optional argument a window's tool takes: which window (from list_windows; the one you're working in if left out). */
export const WINDOW_ARG = {
  window: z.number().int().positive().optional().describe('Which Pigmento window (an id from list_windows). Leave it out for the window the user is working in.'),
};
