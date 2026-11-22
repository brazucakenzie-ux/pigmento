import { z } from 'zod';
import type { ToolDef } from './types';

/**
 * Tools that change the picture (Stop 8B), carried out by the window: each call is one
 * "Assistant: …" undo step. Naming a layer makes it the active one, as clicking it would.
 */

/** Pigmento's blend modes (the same as the Layers panel's; a unit test keeps them in step). */
export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'difference', 'soft-light', 'hard-light', 'hue', 'saturation', 'color', 'luminosity'] as const;

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
