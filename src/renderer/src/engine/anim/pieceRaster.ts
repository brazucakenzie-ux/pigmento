import { rectIntersect, type Rect } from '../core/geometry';
import type { Layer, PaintDocument } from '../doc/Document';
import type { LayerExtras } from '../raster/blend';
import { applyImage, type PixelView } from '../raster/pixels';
import { affineTransform } from '../raster/transform';
import { stateMatrix } from './interpolate';
import { pieceBounds, pieceStateAt, type Piece } from './piece';
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

/** Draw one piece as it is at `frame` into view, inside r (bilinear, premultiplied, like the screen). */
export function drawPiece(view: PixelView, r: Rect, p: Piece, frame: number): void {
  const s = pieceStateAt(p, frame);
  if (s.opacity <= 0) return;
  const area = rectIntersect(pieceBounds(p, frame), r);
  if (!area) return;
  const img = affineTransform(p.src, stateMatrix(s, p.pivot), true, area);
  if (img.w === 0 || img.h === 0) return;
  applyImage(view, { x: img.x, y: img.y, w: img.w, h: img.h }, { data: img.data, stride: img.w, ox: img.x, oy: img.y }, 'over', s.opacity);
}

/**
 * The pixel path's view of a frame (flatten, export, colour picker): each frame-by-frame
 * layer's drawing for `frame`, and each layer's pieces at `frame` drawn into an isolated copy
 * of that layer before it's blended.
 */
export function frameExtras(doc: PaintDocument, frame: number): LayerExtras | undefined {
  const cels = doc.hasCels;
  if (!doc.pieces.length && !cels) return undefined;
  const byLayer = piecesByLayer(doc.pieces);
  const visibleIn = (layer: Layer, r: Rect): Piece[] =>
    (byLayer.get(layer.id) ?? []).filter((p) => pieceStateAt(p, frame).opacity > 0 && rectIntersect(pieceBounds(p, frame), r) !== null);
  return {
    covers: (layer, r) => layer.kind === 'raster' && visibleIn(layer, r).length > 0,
    draw: (layer, r, view) => {
      for (const p of visibleIn(layer, r)) drawPiece(view, r, p, frame);
    },
    surfaceOf: cels ? (layer) => (layer.cels ? celAt(layer.cels, frame).surface : null) : undefined,
  };
}
