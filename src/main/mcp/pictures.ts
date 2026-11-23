import path from 'node:path';
import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { formatFromPath } from '@shared/formats';
import type { AssistantResult } from '@shared/ipc';
import { grantPath } from '../files';
import { checkPath, samePath } from './paths';
import type { ToolContext, ToolDef } from './types';

/**
 * Pictures and their files (8.7): new, open, save, export, close and switch. These are answered
 * here, where paths are checked against the settings and allowed for the window, and the window
 * then does the rest. A new or opened picture never replaces unsaved work unless the assistant
 * says what to do with it.
 */

const WHERE = z
  .enum(['this', 'new'])
  .optional()
  .describe('This window or a new one. Left out: this window if its picture has no unsaved changes, otherwise a new window.');
const UNSAVED = z
  .enum(['save', 'discard'])
  .optional()
  .describe('What to do with unsaved changes in the picture this replaces or closes: save them first, or throw them away (that can’t be undone). Needed only when there are some.');
const OVERWRITE = z.boolean().optional().describe('Replace the file if it’s already there (otherwise you’re told it is).');
const QUALITY = z.number().int().min(1).max(100).optional().describe('JPEG and WebP quality, 1 to 100 (Pigmento’s export setting if left out).');
const PATH = (what: string) => z.string().describe(`The ${what}’s full path, like C:\\Users\\you\\Pictures\\picture.png.`);

const SAVE_FORMATS = '.pigm (keeps layers, animation and everything else), .png, .jpg, .webp, .bmp or .gif';
const EXPORT_FORMATS = '.png, .jpg, .webp, .bmp or .gif';

/** Unsaved changes in a window's picture, dealt with as the assistant said (or an error saying to). */
async function settleUnsaved(ctx: ToolContext, win: BrowserWindow, unsaved: unknown, doing: string): Promise<void> {
  const pic = await ctx.picture(win);
  if (!pic.dirty || unsaved === 'discard') return;
  if (unsaved === 'save') {
    await saveIn(ctx, win, {});
    return;
  }
  throw new Error(`${pic.name} has unsaved changes. To ${doing}, say unsaved: 'save' or 'discard'.`);
}

/** The window a new or opened picture goes in. */
async function placeFor(ctx: ToolContext, args: Record<string, unknown>, doing: string): Promise<BrowserWindow> {
  if (args.where === 'new') return ctx.newWindow();
  if (args.where === undefined && (await ctx.picture(ctx.win)).dirty) return ctx.newWindow();
  await settleUnsaved(ctx, ctx.win, args.unsaved, doing);
  return ctx.win;
}

/** Save a window's picture: to its own file, or to `path` (Save as). */
async function saveIn(ctx: ToolContext, win: BrowserWindow, args: Record<string, unknown>): Promise<AssistantResult> {
  await ctx.permit('files');
  const pic = await ctx.picture(win);
  const raw = args.path ?? pic.path;
  if (raw === null) throw new Error(`${pic.name} has never been saved: give a path to save it to, ending in ${SAVE_FORMATS}.`);
  // Saving over its own file is plain Save.
  const own = pic.path !== null && typeof raw === 'string' && samePath(raw, pic.path);
  const p = await checkPath(raw, { folder: ctx.settings.folder, mustExist: false, overwrite: args.overwrite === true || own });
  const format = formatFromPath(p);
  if (!format) throw new Error(`Pigmento can’t save ${path.basename(p)}: the name has to end in ${SAVE_FORMATS}.`);
  grantPath(p);
  return ctx.call(win, 'save_file', { path: p, format, ...(args.quality !== undefined ? { quality: args.quality } : {}) });
}

/** A window's answer, saying which window it is. */
function inWindow(r: AssistantResult, win: BrowserWindow): AssistantResult {
  const data = r.data !== null && typeof r.data === 'object' ? r.data : {};
  return { ...r, data: { ...data, window: win.id } };
}

export const PICTURE_TOOLS: readonly ToolDef[] = [
  {
    name: 'new_picture',
    title: 'New picture',
    description: 'Make a new, empty picture, in this window or a new one (see where). The picture you work on after this is the new one.',
    kind: 'pictures',
    input: {
      width: z.number().int().min(1).max(30000).describe('Width in pixels.'),
      height: z.number().int().min(1).max(30000).describe('Height in pixels.'),
      paper: z
        .string()
        .regex(/^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|none)$/)
        .optional()
        .describe('The paper colour as #rrggbb (or #rrggbbaa), or none for see-through. White if left out.'),
      dpi: z.number().int().min(1).max(10000).optional().describe('Dots per inch, for printing (96 if left out).'),
      where: WHERE,
      unsaved: UNSAVED,
    },
    readOnly: false,
    destructive: true,
    main: async (ctx, args) => {
      const win = await placeFor(ctx, args, 'make a new picture here');
      const { where: _w, unsaved: _u, ...rest } = args;
      return inWindow(await ctx.call(win, 'new_picture', rest), win);
    },
  },
  {
    name: 'open_file',
    title: 'Open file',
    description: `Open a picture file (${SAVE_FORMATS}, and other images Pigmento reads), in this window or a new one (see where).`,
    kind: 'files',
    input: { path: PATH('file'), where: WHERE, unsaved: UNSAVED },
    readOnly: false,
    destructive: true,
    main: async (ctx, args) => {
      const p = await checkPath(args.path, { folder: ctx.settings.folder, mustExist: true, overwrite: true });
      await ctx.permit('pictures');
      const win = await placeFor(ctx, args, 'open a file here');
      grantPath(p);
      return inWindow(await ctx.call(win, 'open_file', { path: p }), win);
    },
  },
  {
    name: 'save_file',
    title: 'Save',
    description: `Save the picture to its file, or to a new path (Save as). The kind of file comes from the name: ${SAVE_FORMATS}. Only .pigm keeps layers and animation; the others keep the picture as it looks (the frame shown, for an animation).`,
    kind: 'files',
    input: { path: PATH('file').optional().describe(`Where to save it (Save as), ending in ${SAVE_FORMATS}. Leave it out to save to the picture’s own file.`), overwrite: OVERWRITE, quality: QUALITY },
    readOnly: false,
    destructive: true,
    main: (ctx, args) => saveIn(ctx, ctx.win, args),
  },
  {
    name: 'export_image',
    title: 'Export image',
    description: `Export a copy of the picture (or one layer) as ${EXPORT_FORMATS}, at a scale. The picture, its file and whether it is saved don’t change.`,
    kind: 'files',
    input: {
      path: PATH('image'),
      scale: z.number().min(0.01).max(16).optional().describe('Size compared with the picture: 2 is twice as big (1 if left out).'),
      layer: z.string().optional().describe('Export just this layer or group (an id from get_picture_info).'),
      transparent: z.boolean().optional().describe('Leave the paper out (for .png, .webp and .gif). False if left out.'),
      quality: QUALITY,
      overwrite: OVERWRITE,
    },
    readOnly: false,
    destructive: true,
    main: async (ctx, args) => {
      const p = await checkPath(args.path, { folder: ctx.settings.folder, mustExist: false, overwrite: args.overwrite === true });
      const format = formatFromPath(p);
      if (!format || format === 'pigm') throw new Error(`Pigmento exports ${EXPORT_FORMATS} files (save_file saves .pigm).`);
      grantPath(p);
      const { overwrite: _o, ...rest } = args;
      return ctx.call(ctx.win, 'export_image', { ...rest, path: p, format });
    },
  },
  {
    name: 'close_window',
    title: 'Close window',
    description: 'Close a Pigmento window and its picture. If the picture has unsaved changes, say what to do with them (unsaved). The last window can’t be closed (that would close Pigmento).',
    kind: 'pictures',
    input: { unsaved: UNSAVED },
    readOnly: false,
    destructive: true,
    main: async (ctx, args) => {
      if (BrowserWindow.getAllWindows().length <= 1) throw new Error('That’s the last Pigmento window: closing it would close Pigmento. Make a new picture in it instead.');
      const pic = await ctx.picture(ctx.win);
      await settleUnsaved(ctx, ctx.win, args.unsaved, 'close it');
      ctx.close(ctx.win);
      return { text: `Closed the window with ${pic.name}.` };
    },
  },
  {
    name: 'focus_window',
    title: 'Switch window',
    description: 'Bring a Pigmento window to the front, so it is the one being worked in (tools that don’t name a window act on it).',
    kind: 'pictures',
    input: { window: z.number().int().positive().describe('The window (an id from list_windows).') },
    readOnly: false,
    main: async (ctx) => {
      ctx.focus(ctx.win);
      return { text: `Switched to ${(await ctx.picture(ctx.win)).name}.`, data: { window: ctx.win.id } };
    },
  },
];
