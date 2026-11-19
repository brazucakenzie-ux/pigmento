import { rectIntersect, type Rect } from '../core/geometry';
import { walkLayers, type Layer, type PaintDocument } from '../doc/Document';
import type { LayerExtras } from '../raster/blend';
import { applyImage, type PixelView } from '../raster/pixels';
import type { PieceState } from './interpolate';
import { sampleAffine, type Tiling } from './pieceSample';
import { sampleProjective } from './pieceProject';
import { repeatAxes, type Piece } from './piece';
import { Scene } from './scene';
import { defaultLight, type Light } from './space';
import { celAt } from './cels';

/** The pieces of pixels (not groups, which are never drawn) by the layer they belong to, bottom to top. */
export function piecesByLayer(pieces: readonly Piece[]): Map<string, Piece[]> {
  const out = new Map<string, Piece[]>();
  for (const p of pieces) {
    if (p.kind === 'group') continue;
    const list = out.get(p.layerId);
    if (list) list.push(p);
    else out.set(p.layerId, [p]);
  }
  return out;
}

/**
 * The pieces of pixels on layers that are showing, in the order they're drawn (bottom to top):
 * layer by layer, and each layer's back to front as `scene` has them.
 */
export function piecesInDrawOrder(doc: PaintDocument, scene: Scene): Piece[] {
  const byLayer = piecesByLayer(doc.pieces);
  const out: Piece[] = [];
  for (const layer of walkLayers(doc.layers)) {
    const list = byLayer.get(layer.id);
    if (list && layer.kind === 'raster' && doc.isEffectivelyVisible(layer.id))
      out.push(...scene.backToFront(list));
  }
  return out;
}

/** How a piece tiles at state s (null when it doesn't repeat). */
export function pieceTiling(p: Piece, s: PieceState): Tiling | null {
  if (p.repeat === 'none') return null;
  return { ...repeatAxes(p.repeat), scrollX: s.scrollX, scrollY: s.scrollY };
}

/**
 * Draw one piece as `scene` has it into view, inside r (bilinear, premultiplied, like the
 * screen): flat ones through their affine, ones in 3D through their homography (see pieceProject).
 */
export function drawPiece(view: PixelView, r: Rect, p: Piece, scene: Scene, light: Light = defaultLight()): void {
  if (!scene.shows(p)) return;
  const { state: s, placement: pl, opacity } = scene.pose(p);
  const tiling = pieceTiling(p, s);
  let img;
  if (pl.affine) {
    const area = tiling ? r : rectIntersect(scene.bounds(p), r);
    if (!area) return;
    img = sampleAffine(p.src, pl.affine, area, tiling);
  } else {
    img = sampleProjective(p.src, pl, r, tiling, tiling ? null : scene.bounds(p), scene.shade(p, light));
  }
  if (img.w === 0 || img.h === 0) return;
  applyImage(view, { x: img.x, y: img.y, w: img.w, h: img.h }, { data: img.data, stride: img.w, ox: img.x, oy: img.y }, 'over', opacity);
}

/**
 * The pixel path's view of a frame (flatten, export, colour picker): each frame-by-frame
 * layer's drawing for `frame`, and each layer's pieces at `frame` (back to front) drawn into an
 * isolated copy of that layer before it's blended.
 */
export function frameExtras(doc: PaintDocument, frame: number): LayerExtras | undefined {
  const cels = doc.hasCels;
  if (!doc.pieces.length && !cels) return undefined;
  const scene = new Scene(doc.pieces, frame, doc.space);
  const byLayer = piecesByLayer(doc.pieces);
  const visibleIn = (layer: Layer, r: Rect): Piece[] =>
    (byLayer.get(layer.id) ?? []).filter((p) => scene.shows(p) && scene.touches(p, r));
  return {
    covers: (layer, r) => layer.kind === 'raster' && visibleIn(layer, r).length > 0,
    draw: (layer, r, view) => {
      for (const p of scene.backToFront(visibleIn(layer, r))) drawPiece(view, r, p, scene, doc.light);
    },
    surfaceOf: cels ? (layer) => (layer.cels ? celAt(layer.cels, frame).surface : null) : undefined,
  };
}
