import { BrowserWindow } from 'electron';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ANIM_TOOLS } from './anim';
import { IMAGE_TOOLS, LAYER_TOOLS, PAINT_TOOLS } from './edit';
import { PICTURE_TOOLS } from './pictures';
import { WINDOW_ARG, type ToolDef } from './types';

/** What assistants are told about Pigmento when they connect. */
export const MCP_INSTRUCTIONS = [
  'Pigmento is a painting and animation app for Windows. Its tools act on the picture in the window the user is working in, while they watch, or in the window you name (an id from list_windows).',
  'Positions and sizes are in picture pixels, from the top-left corner, and animation frames are numbered from 1, as in the timeline. Start with get_picture_info to see the picture you are working on, and use get_picture_image to look at it and check your work.',
  'Every change you make is one undo step the user can take back.',
].join(' ');

/**
 * The tools AI assistants can call. Each is one kind of thing a person does in Pigmento, checked
 * against the permission for that kind (Settings → AI assistants). Most run in a window, on the
 * picture there; a few are answered here in the main process.
 */

/** The biggest picture image an assistant can ask for. */
export const MAX_IMAGE_SIZE = 2048;

export const TOOLS: readonly ToolDef[] = [
  {
    name: 'list_windows',
    title: 'List windows',
    description: 'The Pigmento windows that are open, each with its id and title (the picture in it), and which one the user is working in.',
    kind: 'look',
    input: {},
    readOnly: true,
    noWindow: true,
    main: (ctx) => {
      const windows = ctx.windows();
      return { text: windows.map((w) => `${w.id}: ${w.title}${w.current ? ' (the one being worked in)' : ''}`).join('\n') || 'No windows are open.', data: { windows } };
    },
  },
  {
    name: 'get_picture_info',
    title: 'Picture info',
    description:
      'The picture in a window: its size in pixels, its resolution (DPI), its paper colour, its layers (top first: id, name, kind, visible, opacity, blend mode, which is active), whether it has unsaved changes and its file, the selection, the tool and colours in use, and the animation (frame shown, length, frames a second, frame-by-frame drawings and pieces). Frames are numbered from 1, as in the timeline.',
    kind: 'look',
    input: {},
    readOnly: true,
  },
  {
    name: 'get_picture_image',
    title: 'Picture image',
    description:
      'The picture as a PNG, to see it and check your work: all of it, one layer, a region, or another animation frame. Big pictures are scaled down to fit maxSize (the answer says the scale); the paper is behind the picture, and a single layer is see-through.',
    kind: 'look',
    input: {
      layer: z.string().optional().describe('Just this layer or group (an id from get_picture_info), shown even if it is hidden. Leave it out for the whole picture.'),
      region: z
        .object({ x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive() })
        .optional()
        .describe('Just this part of the picture, in picture pixels from the top-left corner. Leave it out for all of it.'),
      frame: z.number().int().positive().optional().describe('The animation frame (numbered from 1, as in the timeline). Leave it out for the frame shown.'),
      maxSize: z.number().int().min(16).max(MAX_IMAGE_SIZE).optional().describe(`The longest side of the image in pixels, up to ${MAX_IMAGE_SIZE} (1024 if left out). Pictures are never scaled up.`),
    },
    readOnly: true,
  },
  {
    name: 'list_available',
    title: 'List available',
    description:
      'What Pigmento has, by id and name: its tools (with their shortcut letters), brushes, shapes, effects and adjustments (with their settings), or actions (the commands in its menus, with their shortcuts and whether they can be used now).',
    kind: 'look',
    input: { what: z.enum(['tools', 'brushes', 'shapes', 'effects', 'actions']).describe('Which list.') },
    readOnly: true,
  },
  ...PICTURE_TOOLS,
  ...LAYER_TOOLS,
  ...PAINT_TOOLS,
  ...IMAGE_TOOLS,
  ...ANIM_TOOLS,
];


/** The same views as resources, of the window being worked in: each is read through its tool. */
export interface ResourceDef {
  name: string;
  uri: string;
  title: string;
  description: string;
  mimeType: 'application/json' | 'image/png';
  tool: string;
}

export const RESOURCES: readonly ResourceDef[] = [
  { name: 'windows', uri: 'pigmento://windows', title: 'Windows', description: 'The Pigmento windows that are open.', mimeType: 'application/json', tool: 'list_windows' },
  { name: 'picture-info', uri: 'pigmento://picture/info', title: 'Picture info', description: 'The picture in the window being worked in: size, layers, selection, animation.', mimeType: 'application/json', tool: 'get_picture_info' },
  { name: 'picture-image', uri: 'pigmento://picture/image', title: 'Picture image', description: 'The picture in the window being worked in, as a PNG up to 1024 pixels.', mimeType: 'image/png', tool: 'get_picture_image' },
];

/** Build an MCP server populated with all Pigmento tools, resources, and instructions. */
export function createMcpServer(
  version: string,
  handlers: {
    callTool: (tool: ToolDef, args: Record<string, unknown>, client: string) => Promise<CallToolResult>;
    readResource: (uri: URL, res: ResourceDef, tool: ToolDef, client: string) => Promise<ReadResourceResult>;
    onInitialized?: (client: string) => void;
  },
): McpServer {
  const mcp = new McpServer({ name: 'pigmento', title: 'Pigmento', version }, { capabilities: { tools: {}, resources: {} }, instructions: MCP_INSTRUCTIONS });
  const client = () => mcp.server.getClientVersion()?.title ?? mcp.server.getClientVersion()?.name ?? 'An AI assistant';
  if (handlers.onInitialized) mcp.server.oninitialized = () => handlers.onInitialized!(client());
  for (const tool of TOOLS) {
    mcp.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.noWindow ? tool.input : { ...WINDOW_ARG, ...tool.input },
        annotations: { readOnlyHint: tool.readOnly, destructiveHint: tool.destructive ?? false, openWorldHint: false },
      },
      async (args: Record<string, unknown>) => handlers.callTool(tool, args, client()),
    );
  }
  for (const res of RESOURCES) {
    const tool = TOOLS.find((d) => d.name === res.tool);
    if (!tool) throw new Error(`The resource ${res.uri} has no tool ${res.tool}`);
    mcp.registerResource(res.name, res.uri, { title: res.title, description: res.description, mimeType: res.mimeType }, (uri) => handlers.readResource(uri, res, tool, client()));
  }
  return mcp;
}

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
