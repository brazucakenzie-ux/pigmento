import { rectIntersect, type Rect } from '../core/geometry';
import { walkLayers, type Layer, type PaintDocument } from '../doc/Document';
import type { LayerExtras } from '../raster/blend';
import { applyImage, type PixelView } from '../raster/pixels';
import type { PieceState } from './interpolate';
import { sampleAffine, type Tiling } from './pieceSample';
import { sampleProjective, sampleProjectiveBatch, type BatchSheet } from './pieceProject';
import { repeatAxes, type Piece } from './piece';
import type { Scene } from './scene';
import { sceneOf } from './follow';
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

/** Pieces that share an edge with another by a hinge (they hang off one, or one hangs off them). */
export function hingedIds(pieces: readonly Piece[]): Set<string> {
  const out = new Set<string>();
  for (const p of pieces) {
    if (!p.link?.hinge) continue;
    out.add(p.id);
    out.add(p.link.parent);
  }
  return out;
}

/**
 * Pieces in drawing order, with each run of hinged faces next to each other gathered up so the
 * run is drawn as one picture and its seams stay solid. Repeating pieces are never gathered.
 */
export function drawRuns(order: readonly Piece[], hinged: ReadonlySet<string>): Piece[][] {
  const runs: Piece[][] = [];
  const joins = (p: Piece) => hinged.has(p.id) && p.repeat === 'none';
  for (const p of order) {
    const last = runs[runs.length - 1];
    if (last && joins(p) && joins(last[0])) last.push(p);
    else runs.push([p]);
  }
  return runs;
}

/** A run of hinged faces as `scene` has them, ready to draw together. */
export function runSheets(run: readonly Piece[], scene: Scene, light: Light): BatchSheet[] {
  return run.map((p) => ({ src: p.src, pl: scene.placement(p), shade: scene.shade(p, light), opacity: scene.opacity(p), bounds: scene.bounds(p) }));
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
  const scene = sceneOf(doc, frame);
  const byLayer = piecesByLayer(doc.pieces);
  const hinged = hingedIds(doc.pieces);
  const visibleIn = (layer: Layer, r: Rect): Piece[] =>
    (byLayer.get(layer.id) ?? []).filter((p) => scene.shows(p) && scene.touches(p, r));
  return {
    covers: (layer, r) => layer.kind === 'raster' && visibleIn(layer, r).length > 0,
    draw: (layer, r, view) => {
      for (const run of drawRuns(scene.backToFront(visibleIn(layer, r)), hinged)) {
        if (run.length === 1) {
          drawPiece(view, r, run[0], scene, doc.light);
          continue;
        }
        const img = sampleProjectiveBatch(runSheets(run, scene, doc.light), r);
        if (img.w > 0 && img.h > 0) applyImage(view, { x: img.x, y: img.y, w: img.w, h: img.h }, { data: img.data, stride: img.w, ox: img.x, oy: img.y }, 'over', 1);
      }
    },
    surfaceOf: cels ? (layer) => (layer.cels ? celAt(layer.cels, frame).surface : null) : undefined,
  };
}
