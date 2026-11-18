import { rectIntersect, type Rect } from '../core/geometry';
import type { Layer, PaintDocument } from '../doc/Document';
import type { LayerExtras } from '../raster/blend';
import { applyImage, type PixelView } from '../raster/pixels';
import type { PieceState } from './interpolate';
import { sampleAffine, type Tiling } from './pieceSample';
import { sampleProjective } from './pieceProject';
import { backToFront, pieceBounds, pieceStateAt, pieceTouches, repeatAxes, type Piece } from './piece';
import { FLAT_SPACE, placementOf, type Space } from './space';
import { celAt } from './cels';

/** Pieces grouped by the layer they belong to, bottom to top. */
export function piecesByLayer(pieces: readonly Piece[]): Map<string, Piece[]> {
  const out = new Map<string, Piece[]>();
  for (const p of pieces) {
    const list = out.get(p.layerId);
    if (list) list.push(p);
    else out.set(p.layerId, [p]);
  }
  return out;
}

/** How a piece tiles at state s (null when it doesn't repeat). */
export function pieceTiling(p: Piece, s: PieceState): Tiling | null {
  if (p.repeat === 'none') return null;
  return { ...repeatAxes(p.repeat), scrollX: s.scrollX, scrollY: s.scrollY };
}

/**
 * Draw one piece as it is at `frame` into view, inside r (bilinear, premultiplied, like the
 * screen): flat ones through their affine, ones in 3D through their homography (see pieceProject).
 */
export function drawPiece(view: PixelView, r: Rect, p: Piece, frame: number, space: Space = FLAT_SPACE): void {
  const s = pieceStateAt(p, frame);
  if (s.opacity <= 0) return;
  const pl = placementOf(s, p.pivot, p.src.width, p.src.height, space);
  if (!pl.front && p.back === 'hide') return;
  const tiling = pieceTiling(p, s);
  let img;
  if (pl.affine) {
    const area = tiling ? r : rectIntersect(pieceBounds(p, frame, space), r);
    if (!area) return;
    img = sampleAffine(p.src, pl.affine, area, tiling);
  } else {
    img = sampleProjective(p.src, pl, r, tiling, tiling ? null : pieceBounds(p, frame, space));
  }
  if (img.w === 0 || img.h === 0) return;
  applyImage(view, { x: img.x, y: img.y, w: img.w, h: img.h }, { data: img.data, stride: img.w, ox: img.x, oy: img.y }, 'over', s.opacity);
}

/**
 * The pixel path's view of a frame (flatten, export, colour picker): each frame-by-frame
 * layer's drawing for `frame`, and each layer's pieces at `frame` (back to front) drawn into an
 * isolated copy of that layer before it's blended.
 */
export function frameExtras(doc: PaintDocument, frame: number): LayerExtras | undefined {
  const cels = doc.hasCels;
  if (!doc.pieces.length && !cels) return undefined;
  const space = doc.space;
  const byLayer = piecesByLayer(doc.pieces);
  const visibleIn = (layer: Layer, r: Rect): Piece[] =>
    (byLayer.get(layer.id) ?? []).filter((p) => pieceStateAt(p, frame).opacity > 0 && pieceTouches(p, frame, r, space));
  return {
    covers: (layer, r) => layer.kind === 'raster' && visibleIn(layer, r).length > 0,
    draw: (layer, r, view) => {
      for (const p of backToFront(visibleIn(layer, r), frame, space)) drawPiece(view, r, p, frame, space);
    },
    surfaceOf: cels ? (layer) => (layer.cels ? celAt(layer.cels, frame).surface : null) : undefined,
  };
}
