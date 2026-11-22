import { z } from 'zod';
import { grantPath } from '../files';
import { checkPath } from './paths';
import type { ToolDef } from './types';

/**
 * Animating (Stop 8C): pieces and their keyframes, the timeline and the 3D scene. Frames are
 * numbered from 1, as in the timeline; working at a frame goes to it, as a person would. Each
 * call is one "Assistant: …" undo step.
 */

const PIECE = z.string().describe('The piece (an id from get_picture_info).');
const FRAME = z.number().int().min(1).describe('The frame (numbered from 1, as in the timeline).');
const EASING = z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold']);
const POINT = z.object({ x: z.number(), y: z.number() });

export const ANIM_TOOLS: readonly ToolDef[] = [
  {
    name: 'make_piece',
    title: 'Make piece',
    description:
      'Make a piece to animate: from the selection on a pixels layer (Animate selection), from a whole pixels layer (Piece from layer), from an image file (Place image), or a 3D box of coloured faces. A piece moves, turns and fades by its keyframes; it starts where it is, at the frame shown.',
    kind: 'edit',
    readOnly: false,
    input: {
      from: z.enum(['selection', 'layer', 'image', 'box']),
      layer: z.string().optional().describe('selection and layer: the pixels layer (an id); it becomes the active layer. The active layer if left out.'),
      keepOriginal: z.boolean().optional().describe('selection and layer: leave the pixels on the layer too (false: they move into the piece).'),
      path: z.string().optional().describe('image: the image file’s full path.'),
      width: z.number().int().min(1).max(4000).optional().describe('box: across, in pixels.'),
      height: z.number().int().min(1).max(4000).optional().describe('box: down, in pixels.'),
      depth: z.number().int().min(1).max(4000).optional().describe('box: back, in pixels.'),
      name: z.string().min(1).max(200).optional().describe('Its name.'),
    },
    main: async (ctx, args) => {
      if (args.from !== 'image') return ctx.call(ctx.win, 'make_piece', args);
      // Placing an image reads a file: the files permission and the folder limit apply.
      await ctx.permit('files');
      const p = await checkPath(args.path, { folder: ctx.settings.folder, mustExist: true, overwrite: true });
      grantPath(p);
      return ctx.call(ctx.win, 'make_piece', { ...args, path: p });
    },
  },
  {
    name: 'set_keyframe',
    title: 'Keyframe',
    description:
      'Set a piece’s values at a frame, making a keyframe there (or remove one). Between keyframes the piece moves smoothly, eased as the earlier keyframe says. Values left out stay as they are at that frame. The timeline goes to that frame.',
    kind: 'edit',
    readOnly: false,
    input: {
      piece: PIECE,
      frame: FRAME,
      x: z.number().optional().describe('Where its pivot is, in picture pixels.'),
      y: z.number().optional(),
      scale: z.number().optional().describe('Size, times as drawn (1); sets both scaleX and scaleY. Negative flips it.'),
      scaleX: z.number().optional(),
      scaleY: z.number().optional(),
      rotate: z.number().optional().describe('Degrees, clockwise (720 is two whole turns).'),
      skew: z.number().min(-85).max(85).optional().describe('Degrees.'),
      opacity: z.number().min(0).max(1).optional().describe('0 (gone) to 1.'),
      scrollX: z.number().optional().describe('A repeating piece: how far its tiles have slid, in its own pixels.'),
      scrollY: z.number().optional(),
      depth: z.number().optional().describe('3D: pixels behind the canvas (negative: in front).'),
      tilt: z.number().optional().describe('3D: degrees tipped back.'),
      turn: z.number().optional().describe('3D: degrees turned round.'),
      fold: z.number().optional().describe('A hinged piece: degrees folded round its edge.'),
      easing: EASING.optional().describe('How it moves from this keyframe to the next: linear, easeIn, easeOut, easeInOut, or hold (jumps at the next).'),
      curveIn: POINT.nullable().optional().describe('Bends its path arriving here: a handle relative to this keyframe’s position (null: straight).'),
      curveOut: POINT.nullable().optional().describe('Bends its path leaving here towards the next keyframe (null: straight).'),
      remove: z.boolean().optional().describe('Remove the keyframe at this frame instead.'),
    },
  },
  {
    name: 'set_piece',
    title: 'Piece',
    description:
      'Change a piece: its name; how its moves repeat after the last keyframe (loop); follow another piece (moving with it) or hang off one of its edges (hinge), or let go; what shows of its back when turned round in 3D; its shading by the light; tiling copies of it; its pivot; or delete it.',
    kind: 'edit',
    readOnly: false,
    input: {
      piece: PIECE,
      name: z.string().min(1).max(200).optional(),
      loop: z.enum(['off', 'loop', 'pingpong']).optional().describe('After its last keyframe: stop (off), go round again (loop), or back and forth (pingpong).'),
      follow: z.string().optional().describe('Another piece (an id) it moves with from now on, staying where it is; "none" lets go.'),
      hinge: z
        .object({
          to: z.string().describe('The piece it hangs from.'),
          edge: z.enum(['n', 'e', 's', 'w']).describe('Which edge of that piece: n (top), e (right), s (bottom) or w (left).'),
          childEdge: z.enum(['n', 'e', 's', 'w']).optional().describe('Which of its own edges meets it (the opposite one if left out).'),
          fold: z.number().optional().describe('Degrees folded round the edge (0 if left out).'),
        })
        .optional(),
      back: z.enum(['mirror', 'hide']).optional().describe('3D: its back shows mirrored, or not at all.'),
      shade: z.number().min(0).max(1).optional().describe('3D: how much the light shades it, 0 (off) to 1.'),
      repeat: z.enum(['none', 'x', 'y', 'both']).optional().describe('Tile copies of it across (x), down (y) or both.'),
      pivot: z.union([POINT, z.literal('centre')]).optional().describe('The point it turns and scales about, in picture pixels, or centre (a group’s: the middle of its pieces).'),
      delete: z.boolean().optional().describe('Delete the piece (and the pieces that follow it).'),
    },
  },
  {
    name: 'edit_drawing',
    title: 'Drawing',
    description:
      'Frame-by-frame drawings, on a pixels layer or a piece: a new drawing (blank, or a copy of the one shown) starting at a frame, clearing or deleting the drawing shown at a frame, moving where a drawing starts, or looping the drawings for the whole animation. Painting tools paint on a layer’s drawing shown at the frame shown (set_animation frame, or the frame a tool works at).',
    kind: 'edit',
    readOnly: false,
    input: {
      on: z.string().optional().describe('The pixels layer or piece (an id). The active layer if left out.'),
      action: z.enum(['new', 'copy', 'clear', 'delete', 'retime', 'loop']).describe('new (blank) or copy (of the one shown), starting at frame; clear or delete the drawing shown at frame; retime: drawing starts at start; loop the drawings.'),
      frame: FRAME.optional().describe('new, copy, clear and delete: the frame (the frame shown if left out); the timeline goes there.'),
      drawing: z.number().int().min(2).optional().describe('retime: which drawing (numbered from 1; the first always starts at frame 1).'),
      start: FRAME.optional().describe('retime: the frame it starts at.'),
      loop: z.enum(['cycle', 'pingpong', 'off']).optional().describe('loop: round and round (cycle), back and forth (pingpong), or not (off: the last drawing holds).'),
      loopEnd: FRAME.optional().describe('loop: the last frame of the cycle (the last drawing shows until then).'),
    },
  },
  {
    name: 'set_animation',
    title: 'Animation',
    description:
      'The animation as a whole: its length in frames, frames a second and how it plays (round and round, once, or back and forth); the frame shown; playing or stopping it in Pigmento (for the user to watch; use get_picture_image with a frame to see frames yourself); and the 3D camera (vanishing point and perspective strength, and keyframed camera moves) and light.',
    kind: 'edit',
    readOnly: false,
    input: {
      length: z.number().int().min(1).max(2000).optional().describe('Frames.'),
      fps: z.number().int().min(1).max(60).optional().describe('Frames a second.'),
      loop: z.enum(['loop', 'once', 'pingpong']).optional().describe('How it plays: round and round (loop), once, or back and forth (pingpong).'),
      frame: FRAME.optional().describe('Show this frame.'),
      play: z.boolean().optional().describe('true plays it in Pigmento, false stops.'),
      camera: z.object({ x: z.number().optional(), y: z.number().optional(), strength: z.number().min(1).max(100).optional() }).optional().describe('The vanishing point (picture pixels) and how strong the perspective is (1 almost flat, 50 a normal lens, 100 strong).'),
      cameraMove: z
        .object({ frame: FRAME, panX: z.number().optional(), panY: z.number().optional(), push: z.number().optional(), easing: EASING.optional() })
        .optional()
        .describe('A camera keyframe: slid across (panX) and down (panY) and moved in (push; negative: back), in picture pixels.'),
      light: z.object({ angle: z.number().optional().describe('Degrees round the view, from above.'), height: z.number().min(0).max(90).optional().describe('0 (low) to 90 (overhead).') }).optional(),
    },
  },
];
