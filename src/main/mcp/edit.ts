import { z } from 'zod';
import { ARROW_HEADS, BLEND_MODES, DASH_STYLES } from '@shared/styles';
import { setActing } from './acting';
import type { ToolDef } from './types';

/**
 * Tools that change the picture (Stop 8B), carried out by the window: each call is one
 * "Assistant: …" undo step. Naming a layer makes it the active one, as clicking it would.
 */


const LAYER = z.string().describe('The layer (an id from get_picture_info).');
const ON_LAYER = z.string().optional().describe('The layer to work on (an id from get_picture_info); it becomes the active layer. The active layer if left out.');
const MODE = z.enum(['replace', 'add', 'subtract', 'intersect']).optional().describe('How it combines with the selection there is (replace if left out).');
const POINT = z.object({ x: z.number(), y: z.number() });

const edit = (d: Omit<ToolDef, 'kind' | 'readOnly'>): ToolDef => ({ ...d, kind: 'edit', readOnly: false });

/** Layers and selections, and moving pixels (8.8). */
export const LAYER_TOOLS: readonly ToolDef[] = [
  edit({
    name: 'add_layer',
    title: 'Add layer',
    description: 'Add a layer above the active one (or above the layer named), and make it active. A pixels layer holds painting; a shapes layer holds shapes you can still edit.',
    input: {
      kind: z.enum(['pixels', 'shapes']).optional().describe('pixels (if left out) or shapes.'),
      name: z.string().min(1).max(200).optional().describe('Its name (Pigmento numbers it if left out).'),
      above: z.string().optional().describe('Put it above this layer (an id) instead of the active one.'),
    },
  }),
  edit({
    name: 'delete_layer',
    title: 'Delete layer',
    description: 'Delete a layer or a group (with what’s in it). The last layer can’t be deleted.',
    input: { layer: LAYER },
  }),
  edit({
    name: 'move_layer',
    title: 'Move layer',
    description: 'Move a layer up or down among its neighbours, to the top or bottom of them, or into a group.',
    input: {
      layer: LAYER,
      to: z.enum(['up', 'down', 'top', 'bottom']).optional().describe('One step up or down, or to the top or bottom (top if into is given).'),
      into: z.string().optional().describe('Move it into this group (an id), or "picture" for the picture’s own list of layers.'),
    },
  }),
  edit({
    name: 'group_layers',
    title: 'Group layers',
    description: 'Put layers in a new group (where the topmost of them was), and make the group active.',
    input: { layers: z.array(z.string()).min(1).describe('The layers (ids).'), name: z.string().min(1).max(200).optional().describe('The group’s name.') },
  }),
  edit({
    name: 'set_layer',
    title: 'Set layer',
    description: 'Change a layer’s name, whether it shows, whether it’s locked, its opacity or blend mode, or make it the active layer.',
    input: {
      layer: LAYER,
      name: z.string().min(1).max(200).optional().describe("Its new name."),
      visible: z.boolean().optional().describe("Show it (true) or hide it (false)."),
      locked: z.boolean().optional().describe("Lock it against changes (true) or unlock it."),
      opacity: z.number().min(0).max(1).optional().describe('0 (see-through) to 1.'),
      blend: z.enum(BLEND_MODES).optional().describe("How it mixes with the layers below."),
      active: z.boolean().optional().describe('true to make it the active layer.'),
    },
  }),
  edit({
    name: 'select',
    title: 'Select',
    description:
      'Change the selection, which painting, effects and moving stay inside: a rectangle, ellipse or polygon; the magic wand (similar colours around a point); a colour range (a colour everywhere); all, none or the opposite; or feather, grow, shrink or make a border of it.',
    input: {
      shape: z.enum(['rectangle', 'ellipse', 'polygon', 'wand', 'color', 'all', 'none', 'invert', 'feather', 'grow', 'shrink', 'border']).describe("What to select, or how to change the selection."),
      mode: MODE,
      x: z.number().optional().describe('rectangle and ellipse: left edge; wand: the point.'),
      y: z.number().optional().describe('rectangle and ellipse: top edge; wand: the point.'),
      width: z.number().positive().optional().describe('rectangle and ellipse.'),
      height: z.number().positive().optional().describe('rectangle and ellipse.'),
      points: z.array(POINT).min(3).optional().describe('polygon: its corners, in order.'),
      color: z.string().optional().describe('color: the colour to select, #rrggbb.'),
      tolerance: z.number().min(0).max(100).optional().describe('wand and color: how different a colour may be, 0 to 100 (25 for the wand and 20 for colour range if left out).'),
      contiguous: z.boolean().optional().describe('wand: only the connected area (true if left out).'),
      allLayers: z.boolean().optional().describe('wand and color: look at everything visible, not just the active layer.'),
      layer: ON_LAYER,
      amount: z.number().positive().max(500).optional().describe('feather, grow, shrink and border: how many pixels.'),
    },
  }),
  edit({
    name: 'transform_pixels',
    title: 'Move pixels',
    description: 'Move, scale, rotate or flip what’s selected on a pixel layer, or the whole layer if nothing is. Moved pixels leave see-through behind them.',
    input: {
      dx: z.number().optional().describe('Pixels to the right (negative: left).'),
      dy: z.number().optional().describe('Pixels down (negative: up).'),
      scaleX: z.number().positive().max(100).optional().describe('Width times this (1 keeps it).'),
      scaleY: z.number().positive().max(100).optional().describe('Height times this (1 keeps it).'),
      rotate: z.number().min(-360).max(360).optional().describe('Degrees, clockwise, around its centre.'),
      flip: z.enum(['horizontal', 'vertical']).optional().describe("Flip it horizontally (left to right) or vertically."),
      layer: ON_LAYER,
    },
  }),
];

const COLOR = (what: string) => z.string().optional().describe(`${what}, #rrggbb or #rrggbbaa (the primary colour if left out).`);
const SHAPE_PAINT = {
  fill: z.string().optional().describe('Fill colour, #rrggbb or #rrggbbaa, or none. Left out with outline also left out: an outline in the primary colour.'),
  outline: z.string().optional().describe('Outline colour, #rrggbb or #rrggbbaa, or none.'),
  outlineWidth: z.number().min(0.5).max(500).optional().describe('Outline width in pixels (3 if left out).'),
};
const ON_SHAPES = 'On a pixels layer it becomes pixels; on a shapes layer it stays an object you can edit.';

/** Painting (8.9). Your tool, its options and your colours aren't changed (set_colors changes the colours). */
export const PAINT_TOOLS: readonly ToolDef[] = [
  edit({
    name: 'set_colors',
    title: 'Set colours',
    description: 'Set Pigmento’s primary and secondary colours (what the user paints with next, and the default for your painting).',
    input: { primary: z.string().optional().describe('#rrggbb or #rrggbbaa.'), secondary: z.string().optional().describe('#rrggbb or #rrggbbaa.') },
  }),
  edit({
    name: 'fill',
    title: 'Fill',
    description: 'Fill with a colour on a pixels layer: the area of similar colour around a point (like the paint bucket), or, with no point, the selection (or the whole layer if nothing is selected).',
    input: {
      x: z.number().optional().describe("Where to fill from, in picture pixels (leave x and y out to fill the selection or the whole layer)."),
      y: z.number().optional().describe("Where to fill from."),
      color: COLOR('The colour'),
      tolerance: z.number().min(0).max(100).optional().describe('How different a colour may be and still fill, 0 to 100 (15 if left out).'),
      contiguous: z.boolean().optional().describe('Only the connected area (true if left out); false fills that colour everywhere.'),
      layer: ON_LAYER,
    },
  }),
  edit({
    name: 'brush_stroke',
    title: 'Brush stroke',
    description:
      'Paint a stroke through points on a pixels layer, with any brush (ids from list_available with what: brushes), as a person would drag it: pressure changes the width and opacity where the brush uses it. Stays inside the selection. With erase, or an eraser brush, it takes paint away.',
    input: {
      points: z
        .array(z.object({ x: z.number(), y: z.number(), pressure: z.number().min(0).max(1).optional().describe('Pen pressure, 0 to 1 (1 if left out).') }))
        .min(1)
        .max(20000)
        .describe('The stroke’s path; one point makes a dot. Points far apart are joined by straight lines.'),
      brush: z.string().optional().describe('The brush (round if left out).'),
      size: z.number().min(1).max(400).optional().describe('Brush size in pixels (8 if left out).'),
      opacity: z.number().min(0).max(1).optional().describe('0 to 1 (1 if left out).'),
      color: COLOR('The colour'),
      erase: z.boolean().optional().describe('Take paint away instead.'),
      layer: ON_LAYER,
    },
  }),
  edit({
    name: 'draw_line',
    title: 'Line',
    description: `Draw a straight line, with arrow heads and dashes if wanted. ${ON_SHAPES}`,
    input: {
      from: POINT,
      to: POINT,
      width: z.number().min(0.5).max(500).optional().describe('Width in pixels (3 if left out).'),
      color: COLOR('The colour'),
      arrowStart: z.enum(ARROW_HEADS).optional().describe("An arrow head at its start (none if left out)."),
      arrowEnd: z.enum(ARROW_HEADS).optional().describe("An arrow head at its end (none if left out)."),
      dash: z.enum(DASH_STYLES).optional().describe("Solid (if left out), dashed or dotted."),
      layer: ON_LAYER,
    },
  }),
  edit({
    name: 'draw_shape',
    title: 'Shape',
    description: `Draw a shape from Pigmento’s library (ids from list_available with what: shapes: rectangle, circle, star-5, heart, arrows, speech bubbles and many more) in a box, turned if wanted, with its own settings. ${ON_SHAPES}`,
    input: {
      shape: z.string().describe('The shape’s id.'),
      x: z.number().describe('The box’s left edge.'),
      y: z.number().describe('The box’s top edge.'),
      width: z.number().positive().describe("The box’s width, in pixels."),
      height: z.number().positive().describe("The box’s height, in pixels."),
      rotate: z.number().min(-360).max(360).optional().describe('Degrees, clockwise, around the box’s centre.'),
      settings: z.record(z.string(), z.number()).optional().describe('The shape’s own settings by key (list_available with what: shapes gives them); the defaults are used for any left out.'),
      ...SHAPE_PAINT,
      layer: ON_LAYER,
    },
  }),
  edit({
    name: 'draw_path',
    title: 'Path',
    description: `Draw a path through points (like the Pen): straight between points, or curved by each point’s in and out handles (Bézier control points). Closed paths can be filled. ${ON_SHAPES}`,
    input: {
      points: z
        .array(z.object({ x: z.number(), y: z.number(), in: POINT.optional().describe('Handle towards the point before.'), out: POINT.optional().describe('Handle towards the point after.') }))
        .min(2)
        .max(5000)
        .describe('The path’s points, in order, each with optional in and out handles.'),
      closed: z.boolean().optional().describe('Join the last point back to the first (false if left out).'),
      ...SHAPE_PAINT,
      layer: ON_LAYER,
    },
  }),
  edit({
    name: 'add_text',
    title: 'Text',
    description: 'Write text on a pixels layer, its top-left corner at x, y. New lines (\\n) start new lines; with a width, long lines wrap.',
    input: {
      text: z.string().min(1).max(10000).describe("What to write."),
      x: z.number().describe("Its left edge, in picture pixels."),
      y: z.number().describe("Its top edge."),
      width: z.number().positive().optional().describe('Wrap lines at this width in pixels.'),
      font: z.string().optional().describe('A font on this PC, like Segoe UI (if left out), Arial, Georgia, Times New Roman, Consolas or Comic Sans MS.'),
      size: z.number().min(1).max(1000).optional().describe('Font size in the chosen unit (24 if left out).'),
      unit: z.enum(['px', 'pt']).optional().describe('Unit for size: px (picture pixels, if left out) or pt (points, scaled by the picture’s DPI).'),
      bold: z.boolean().optional().describe("Bold."),
      italic: z.boolean().optional().describe("Italic."),
      underline: z.boolean().optional().describe("Underlined."),
      align: z.enum(['left', 'center', 'right']).optional().describe("How lines line up (left if left out)."),
      color: COLOR('The colour'),
      background: z.string().optional().describe('A colour behind the text, #rrggbb (none if left out).'),
      layer: ON_LAYER,
    },
  }),
];

/** The image, effects, actions and settings (8.10). */
export const IMAGE_TOOLS: readonly ToolDef[] = [
  edit({
    name: 'resize_image',
    title: 'Resize',
    description: 'Resize the whole picture (every layer). Give a width, a height (the other follows, keeping its shape), both, or a scale. The selection is let go first.',
    input: {
      width: z.number().int().min(1).max(30000).optional().describe("The new width, in pixels."),
      height: z.number().int().min(1).max(30000).optional().describe("The new height, in pixels."),
      scale: z.number().min(0.01).max(16).optional().describe('Times the size it is (0.5 is half).'),
      method: z.enum(['bicubic', 'bilinear', 'nearest']).optional().describe('bicubic (smooth, if left out), bilinear, or nearest (keeps hard pixels, for pixel art).'),
    },
  }),
  edit({
    name: 'crop',
    title: 'Crop',
    description: 'Crop the picture to a rectangle, or to the selection if no rectangle is given.',
    input: {
      x: z.number().int().optional().describe('The rectangle’s left edge, in picture pixels.'),
      y: z.number().int().optional().describe('Its top edge.'),
      width: z.number().int().positive().optional().describe('Its width.'),
      height: z.number().int().positive().optional().describe('Its height.'),
    },
  }),
  edit({
    name: 'canvas_size',
    title: 'Canvas size',
    description: 'Make the canvas bigger or smaller without scaling what’s on it: new space is see-through (the paper shows), and what falls outside is cut off.',
    input: {
      width: z.number().int().min(1).max(30000).describe("The canvas’s new width, in pixels."),
      height: z.number().int().min(1).max(30000).describe("The canvas’s new height, in pixels."),
      anchor: z.enum(['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se']).optional().describe('Where the picture stays: nw is top-left (if left out), c the centre, se bottom-right…'),
    },
  }),
  edit({
    name: 'set_picture_properties',
    title: 'Image properties',
    description: 'Change the picture’s resolution (DPI) and/or paper colour. Changing DPI doesn’t resize any pixels.',
    input: {
      dpi: z.number().int().min(1).max(10000).optional().describe('Resolution in dots per inch (96 for screen, 300 for print).'),
      paper: z
        .string()
        .regex(/^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|none)$/)
        .optional()
        .describe('The paper colour as #rrggbb (or #rrggbbaa), or none for see-through.'),
    },
  }),
  edit({
    name: 'rotate_flip',
    title: 'Rotate or flip',
    description: 'Rotate the whole picture (90, 180 or 270 degrees keep every pixel; other angles grow the canvas to fit), and/or flip it. The selection is let go first.',
    input: {
      rotate: z.number().min(-360).max(360).optional().describe('Degrees, clockwise.'),
      flip: z.enum(['horizontal', 'vertical']).optional().describe("Flip it horizontally (left to right) or vertically."),
    },
  }),
  edit({
    name: 'apply_effect',
    title: 'Effect',
    description: 'Apply an adjustment or filter (ids from list_available with what: effects, which gives each one’s settings) to a pixels layer, inside the selection if there is one.',
    input: {
      effect: z.string().describe('The effect’s id.'),
      settings: z.record(z.string(), z.unknown()).optional().describe('Its settings by key: numbers for sliders, true or false for toggles, a choice’s value, #rrggbb for colours, [[x, y], …] (0 to 1) for curves. The defaults are used for any left out.'),
      layer: ON_LAYER,
    },
  }),
  {
    name: 'run_action',
    title: 'Action',
    description:
      'Do one of Pigmento’s actions by its id (list_available with what: actions lists them and whether each can be used now), like layerMergeDown, layerFlatten, layerDuplicate, invertColors or gridlines (show the grid). File actions have their own tools; actions that would open a dialog are refused.',
    kind: 'edit',
    readOnly: false,
    input: { action: z.string().describe('The action’s id.') },
    main: async (ctx, args) => {
      const about = (await ctx.call(ctx.win, 'pigmento.action', { action: args.action })).data as { settings: boolean };
      // Actions that change what's shown (the grid, rulers, panels, the theme) change Pigmento's settings.
      if (about.settings) await ctx.permit('settings');
      setActing(ctx.win.webContents, true);
      try {
        return await ctx.call(ctx.win, 'run_action', { action: args.action });
      } finally {
        setActing(ctx.win.webContents, false);
      }
    },
  },
  {
    name: 'get_settings',
    title: 'Settings',
    description: 'Pigmento’s settings, by section (the theme, the view, panels, export, animation and the rest), as change_settings takes them. The AI assistants settings aren’t included.',
    kind: 'look',
    readOnly: true,
    input: {},
  },
  {
    name: 'change_settings',
    title: 'Change settings',
    description: 'Change Pigmento’s settings: sections as get_settings gives them, each with just the values to change, like { "view": { "gridlines": true }, "theme": "forest" }. The AI assistants settings can only be changed by the user.',
    kind: 'settings',
    readOnly: false,
    input: { changes: z.record(z.string(), z.unknown()).describe('The sections to change, and in each the values to change.') },
  },
];
