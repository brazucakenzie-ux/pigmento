import type { Point } from '../core/geometry';
import { Surface } from '../raster/Surface';
import type { ImageBuf } from '../raster/transform';
import type { Edge, Hinge } from './frames';
import { identityState, type Keyframe, type PieceState } from './interpolate';
import { makeGroup, makePiece, type Piece } from './piece';

/** The six faces of a box. */
export type BoxFace = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right';
export const BOX_FACES: readonly BoxFace[] = ['front', 'top', 'bottom', 'left', 'right', 'back'];

/** Biggest side a box can have (each face is a piece). */
export const MAX_BOX_SIDE = 4096;

export interface BoxSize {
  /** Across, down and back, in pixels. */
  w: number;
  h: number;
  d: number;
}

/**
 * How each face hangs: off which face, by which of that face's edges, and by which of its own.
 * Every face folds back by a quarter turn; the back hangs off the right side.
 */
const HANGS: Record<Exclude<BoxFace, 'front'>, { parent: BoxFace; edge: Edge; childEdge: Edge }> = {
  top: { parent: 'front', edge: 'n', childEdge: 's' },
  bottom: { parent: 'front', edge: 's', childEdge: 'n' },
  left: { parent: 'front', edge: 'w', childEdge: 'e' },
  right: { parent: 'front', edge: 'e', childEdge: 'w' },
  back: { parent: 'right', edge: 'e', childEdge: 'w' },
};

/** A face's size: the front and back are w × h, the top and bottom w × d, the sides d × h. */
export function faceSize(face: BoxFace, s: BoxSize): { w: number; h: number } {
  if (face === 'top' || face === 'bottom') return { w: s.w, h: s.d };
  if (face === 'left' || face === 'right') return { w: s.d, h: s.h };
  return { w: s.w, h: s.h };
}

/** White, ready to paint. */
function blank(w: number, h: number): Surface {
  const s = new Surface(w, h);
  s.fillRect({ x: 0, y: 0, w, h }, { r: 255, g: 255, b: 255, a: 255 });
  return s;
}

const key = (s: PieceState, frame: number): Keyframe => ({ ...s, frame, easing: 'linear', in: null, out: null });

/**
 * A box folded from six hinged faces, carried by a group whose pivot is the box's middle: the
 * front sits on the canvas, unturned and at its real size, with its middle at `centre`, and the
 * box goes back from it. Faces are blank (white) unless `faces` gives their pixels (each the size
 * faceSize says). Returned group first, then the faces in BOX_FACES order.
 */
export function makeBox(newId: () => string, layerId: string, centre: Point, size: BoxSize, frame: number, opts: { faces?: Partial<Record<BoxFace, ImageBuf | Surface>>; names?: (face: BoxFace) => string; group?: string; shade?: number } = {}): Piece[] {
  const { w, h, d } = size;
  const home = { x: centre.x - w / 2, y: centre.y - h / 2, w, h };
  // The group's own pixels are the front's: its pivot, the box's middle, is half the depth behind it.
  const group = makeGroup(newId(), opts.group ?? '', layerId, home, { x: w / 2, y: h / 2 }, [key({ ...identityState(centre.x, centre.y), depth: d / 2 }, frame)]);
  const byFace = new Map<BoxFace, Piece>();
  for (const face of BOX_FACES) {
    const fs = faceSize(face, size);
    const src = opts.faces?.[face] ?? blank(fs.w, fs.h);
    const p = makePiece(newId(), opts.names?.(face) ?? '', layerId, src, face === 'front' ? home : { x: 0, y: 0, w: fs.w, h: fs.h }, frame);
    p.shade = opts.shade ?? 0.5;
    if (face === 'front') {
      // Half the depth in front of the group's pivot, square on.
      p.link = { parent: group.id, hinge: null };
      p.keyframes = [key({ ...identityState(w / 2, h / 2), depth: -d / 2 }, frame)];
    } else {
      const hang = HANGS[face];
      const hinge: Hinge = { edge: hang.edge, childEdge: hang.childEdge, offset: 0, along: 1, across: 1 };
      p.link = { parent: byFace.get(hang.parent)!.id, hinge };
      p.keyframes = [key({ ...identityState(fs.w / 2, fs.h / 2), fold: Math.PI / 2 }, frame)];
    }
    byFace.set(face, p);
  }
  return [group, ...BOX_FACES.map((f) => byFace.get(f)!)];
}
