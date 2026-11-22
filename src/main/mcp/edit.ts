import { z } from 'zod';
import { ARROW_HEADS, BLEND_MODES, DASH_STYLES } from '@shared/styles';
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
      name: z.string().min(1).max(200).optional(),
      visible: z.boolean().optional(),
      locked: z.boolean().optional(),
      opacity: z.number().min(0).max(1).optional().describe('0 (see-through) to 1.'),
      blend: z.enum(BLEND_MODES).optional(),
      active: z.boolean().optional().describe('true to make it the active layer.'),
    },
  }),
  edit({
    name: 'select',
    title: 'Select',
    description:
      'Change the selection, which painting, effects and moving stay inside: a rectangle, ellipse or polygon; the magic wand (similar colours around a point); a colour range (a colour everywhere); all, none or the opposite; or feather, grow, shrink or make a border of it.',
    input: {
      shape: z.enum(['rectangle', 'ellipse', 'polygon', 'wand', 'color', 'all', 'none', 'invert', 'feather', 'grow', 'shrink', 'border']),
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
      flip: z.enum(['horizontal', 'vertical']).optional(),
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
      x: z.number().optional(),
      y: z.number().optional(),
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
      arrowStart: z.enum(ARROW_HEADS).optional(),
      arrowEnd: z.enum(ARROW_HEADS).optional(),
      dash: z.enum(DASH_STYLES).optional(),
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
      width: z.number().positive(),
      height: z.number().positive(),
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
        .max(5000),
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
      text: z.string().min(1).max(10000),
      x: z.number(),
      y: z.number(),
      width: z.number().positive().optional().describe('Wrap lines at this width in pixels.'),
      font: z.string().optional().describe('A font on this PC, like Segoe UI (if left out), Arial, Georgia, Times New Roman, Consolas or Comic Sans MS.'),
      size: z.number().min(1).max(1000).optional().describe('Size in points (24 if left out).'),
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      underline: z.boolean().optional(),
      align: z.enum(['left', 'center', 'right']).optional(),
      color: COLOR('The colour'),
      background: z.string().optional().describe('A colour behind the text, #rrggbb (none if left out).'),
      layer: ON_LAYER,
    },
  }),
];
