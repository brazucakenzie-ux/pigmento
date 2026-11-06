import { rectIntersect, rectRoundOut, type Point, type Rect } from '../core/geometry';
import { matIsIntegerTranslation, matRotate, matChain, matTranslate } from '../core/matrix';
import { Selection } from '../doc/Selection';
import { applyColorMask, type MaskView, type PixelView } from '../raster/pixels';
import type { Surface } from '../raster/Surface';
import { affineTransform, type ImageBuf, type TransformedImage } from '../raster/transform';
import {
  applyHomography,
  fitAffine,
  homographyFromQuad,
  mapQuad,
  paramsFromAffine,
  perspectiveWarp,
  quadBounds,
  quadContains,
  quadIsAffine,
  quadToAffine,
  quadWithParams,
  type Quad,
  type TransformParams,
} from '../raster/warp';
import type { Overlay } from '../render/Overlay';
import { handleCursor, ROTATE_HANDLE_OFFSET } from './BoxGeom';
import type { LiveObject } from './LiveObject';
import { dragHandle, flipQuad, handlePoint, isCorner, moveQuad, QUAD_HANDLES, quadCentre, rotateQuad, type QuadHandle, type TransformMode } from './quadEdit';

export type TransformHit = { type: 'handle'; handle: QuadHandle } | { type: 'rotate' } | { type: 'body' } | { type: 'outside' };

/** What the options bar shows while transforming. */
export interface TransformInfo {
  /** Centre, in document pixels. */
  x: number;
  y: number;
  /** Scale in percent of the original. */
  w: number;
  h: number;
  /** Degrees. */
  angle: number;
  skew: number;
  /** Has perspective (not just scale, rotation and skew). */
  distorted: boolean;
}

export interface TransformSource {
  src: ImageBuf;
  corners: Quad;
  /** Outline polygons in source pixel coordinates (for ants and the resulting selection). */
  outline: Point[][];
  /** Lifted area of the layer, hidden while transforming and cleared on apply. */
  hole: MaskView | null;
  /** Selection coverage as an image whose alpha is the mask (same size as src); null = whole layer. */
  maskImg: ImageBuf | null;
  /** Apply even if the corners don't move (e.g. it came from an already moved floating selection). */
  forceCommit?: boolean;
}

/** Cells per side of the triangle mesh that previews a perspective warp on the GPU canvas. */
const MESH = 12;

/**
 * Free transform of a selection or a whole layer: scale, rotate, skew, distort and
 * perspective by moving the four destination corners. Nothing changes in the layer until it
 * is applied (Enter); Esc puts everything back.
 */
export class TransformObject implements LiveObject {
  readonly kind = 'transform' as const;
  readonly historyLabel = 'history.freeTransform' as const;
  readonly lifted = true;
  corners: Quad;
  private readonly startCorners: Quad;
  private readonly src: ImageBuf;
  private readonly outline: Point[][];
  private readonly maskImg: ImageBuf | null;
  private hole: MaskView | null;
  private readonly forceCommit: boolean;
  private display: OffscreenCanvas;
  private drag: { hit: TransformHit; from: Point; start: Quad; mode: TransformMode } | null = null;
  /** Called after every change (the engine reports it to the options bar). */
  onChange: (() => void) | null = null;

  constructor(
    s: TransformSource,
    private readonly docW: number,
    private readonly docH: number,
  ) {
    this.src = s.src;
    this.corners = s.corners;
    this.startCorners = s.corners;
    this.outline = s.outline;
    this.hole = s.hole;
    this.maskImg = s.maskImg;
    this.forceCommit = s.forceCommit === true;
    this.display = new OffscreenCanvas(Math.max(1, s.src.w), Math.max(1, s.src.h));
    this.display.getContext('2d')!.putImageData(new ImageData(s.src.data as Uint8ClampedArray<ArrayBuffer>, s.src.w, s.src.h), 0, 0);
  }

  get width(): number {
    return this.src.w;
  }

  get height(): number {
    return this.src.h;
  }

  /** The whole layer is being transformed (no selection). */
  get wholeLayer(): boolean {
    return this.maskImg === null;
  }

  get isIdentityPlacement(): boolean {
    return !this.forceCommit && this.corners.every((p, i) => Math.abs(p.x - this.startCorners[i].x) < 1e-6 && Math.abs(p.y - this.startCorners[i].y) < 1e-6);
  }

  private get affine() {
    return quadIsAffine(this.corners) ? quadToAffine(this.src.w, this.src.h, this.corners) : null;
  }

  /** Area covered, clipped to the canvas. */
  bounds(): Rect | null {
    return rectIntersect(rectRoundOut(quadBounds(this.corners)), { x: 0, y: 0, w: this.docW, h: this.docH });
  }

  filterBounds(): Rect | null {
    if (!this.hole) return null;
    return { x: this.hole.ox, y: this.hole.oy, w: this.hole.w, h: this.hole.h };
  }

  /** Hides the lifted area of the active layer while transforming. */
  layerFilter = (view: PixelView, r: Rect): void => {
    if (!this.hole) return;
    const hb = rectIntersect(r, { x: this.hole.ox, y: this.hole.oy, w: this.hole.w, h: this.hole.h });
    if (hb) applyColorMask(view, hb, { r: 0, g: 0, b: 0, a: 255 }, this.hole, 'erase', 1);
  };

  draw(ctx: OffscreenCanvasRenderingContext2D): void {
    const m = this.affine;
    ctx.save();
    ctx.imageSmoothingQuality = 'high';
    if (m) {
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.imageSmoothingEnabled = !matIsIntegerTranslation(m);
      ctx.drawImage(this.display, 0, 0);
      ctx.restore();
      return;
    }
    // Perspective preview: a mesh of affine triangles (the exact warp happens on apply).
    ctx.imageSmoothingEnabled = true;
    const H = homographyFromQuad(this.src.w, this.src.h, this.corners);
    const { w, h } = this.src;
    const at = (i: number, j: number): Point => applyHomography(H, (i / MESH) * w, (j / MESH) * h);
    const grid: Point[][] = [];
    for (let j = 0; j <= MESH; j++) {
      const row: Point[] = [];
      for (let i = 0; i <= MESH; i++) row.push(at(i, j));
      grid.push(row);
    }
    for (let j = 0; j < MESH; j++) {
      for (let i = 0; i < MESH; i++) {
        const u0 = (i / MESH) * w;
        const u1 = ((i + 1) / MESH) * w;
        const v0 = (j / MESH) * h;
        const v1 = ((j + 1) / MESH) * h;
        this.drawTriangle(ctx, [{ x: u0, y: v0 }, { x: u1, y: v0 }, { x: u1, y: v1 }], [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1]]);
        this.drawTriangle(ctx, [{ x: u0, y: v0 }, { x: u1, y: v1 }, { x: u0, y: v1 }], [grid[j][i], grid[j + 1][i + 1], grid[j + 1][i]]);
      }
    }
    ctx.restore();
  }

  /** Draw the source triangle s onto destination triangle d (slightly enlarged to hide seams). */
  private drawTriangle(ctx: OffscreenCanvasRenderingContext2D, s: Point[], d: Point[]): void {
    const sx1 = s[1].x - s[0].x;
    const sy1 = s[1].y - s[0].y;
    const sx2 = s[2].x - s[0].x;
    const sy2 = s[2].y - s[0].y;
    const det = sx1 * sy2 - sx2 * sy1;
    if (Math.abs(det) < 1e-9) return;
    const dx1 = d[1].x - d[0].x;
    const dy1 = d[1].y - d[0].y;
    const dx2 = d[2].x - d[0].x;
    const dy2 = d[2].y - d[0].y;
    // Linear part L = D · S⁻¹, then the translation that maps s0 onto d0.
    const a = (dx1 * sy2 - dx2 * sy1) / det;
    const b = (dy1 * sy2 - dy2 * sy1) / det;
    const c = (dx2 * sx1 - dx1 * sx2) / det;
    const dd = (dy2 * sx1 - dy1 * sx2) / det;
    const e = d[0].x - a * s[0].x - c * s[0].y;
    const f = d[0].y - b * s[0].x - dd * s[0].y;
    const cx = (d[0].x + d[1].x + d[2].x) / 3;
    const cy = (d[0].y + d[1].y + d[2].y) / 3;
    const grow = (p: Point): Point => {
      const len = Math.hypot(p.x - cx, p.y - cy) || 1;
      return { x: p.x + ((p.x - cx) / len) * 0.6, y: p.y + ((p.y - cy) / len) * 0.6 };
    };
    const g = d.map(grow);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(g[0].x, g[0].y);
    ctx.lineTo(g[1].x, g[1].y);
    ctx.lineTo(g[2].x, g[2].y);
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, dd, e, f);
    // Only the source cell (plus a pixel of margin) is drawn.
    const x0 = Math.max(0, Math.floor(Math.min(s[0].x, s[1].x, s[2].x)) - 1);
    const y0 = Math.max(0, Math.floor(Math.min(s[0].y, s[1].y, s[2].y)) - 1);
    const x1 = Math.min(this.src.w, Math.ceil(Math.max(s[0].x, s[1].x, s[2].x)) + 1);
    const y1 = Math.min(this.src.h, Math.ceil(Math.max(s[0].y, s[1].y, s[2].y)) + 1);
    if (x1 > x0 && y1 > y0) ctx.drawImage(this.display, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
  }

  /** Final pixels in document space (exact warp). */
  rendered(clipToDoc = true): TransformedImage {
    const clip = clipToDoc ? { x: 0, y: 0, w: this.docW, h: this.docH } : undefined;
    return this.warp(this.src, clip);
  }

  private warp(img: ImageBuf, clip?: Rect): TransformedImage {
    const m = this.affine;
    if (m && matIsIntegerTranslation(m)) return { x: Math.round(m[4]), y: Math.round(m[5]), ...img };
    return m ? affineTransform(img, m, true, clip) : perspectiveWarp(img, this.corners, true, clip);
  }

  rasterize(surface: Surface): void {
    if (this.hole) surface.clearRect({ x: this.hole.ox, y: this.hole.oy, w: this.hole.w, h: this.hole.h }, this.hole);
    const img = this.rendered();
    if (img.w === 0 || img.h === 0) return;
    surface.compositeImage({ x: img.x, y: img.y, w: img.w, h: img.h }, { data: img.data, stride: img.w, ox: img.x, oy: img.y }, 'over');
  }

  /** Outline polygons in document space. */
  transformedOutline(): Point[][] {
    const H = homographyFromQuad(this.src.w, this.src.h, this.corners);
    return this.outline.map((poly) => poly.map((p) => applyHomography(H, p.x, p.y)));
  }

  /** The transformed selection; a whole-layer transform leaves nothing selected. */
  selectionAfterCommit(): Selection | null {
    if (!this.maskImg) return null;
    const placed = this.warp(this.maskImg);
    const mask = new Uint8Array(placed.w * placed.h);
    for (let i = 0; i < mask.length; i++) mask[i] = placed.data[i * 4 + 3];
    const sel = Selection.fromMask({ x: placed.x, y: placed.y, w: placed.w, h: placed.h }, mask, this.transformedOutline(), 'mask');
    return sel ? sel.clipped(this.docW, this.docH) : null;
  }

  // ---- editing -------------------------------------------------------------------------

  /** Rotate handle: beyond the top edge, away from the centre (screen space). */
  private rotateHandle(screen: (p: Point) => Point): Point {
    const top = screen(handlePoint(this.corners, 'n'));
    const c = screen(quadCentre(this.corners, this.src.w, this.src.h));
    const len = Math.hypot(top.x - c.x, top.y - c.y) || 1;
    return { x: top.x + ((top.x - c.x) / len) * ROTATE_HANDLE_OFFSET, y: top.y + ((top.y - c.y) / len) * ROTATE_HANDLE_OFFSET };
  }

  hit(p: Point, sp: Point, screen: (q: Point) => Point, tolerance = 7): TransformHit {
    const r = this.rotateHandle(screen);
    if (Math.abs(r.x - sp.x) <= tolerance && Math.abs(r.y - sp.y) <= tolerance) return { type: 'rotate' };
    // Corners first, so small transforms stay easy to grab.
    for (const h of [...QUAD_HANDLES].sort((a, b) => Number(isCorner(b)) - Number(isCorner(a)))) {
      const hp = screen(handlePoint(this.corners, h));
      if (Math.abs(hp.x - sp.x) <= tolerance && Math.abs(hp.y - sp.y) <= tolerance) return { type: 'handle', handle: h };
    }
    return quadContains(this.corners, p) ? { type: 'body' } : { type: 'outside' };
  }

  /** Angle of the top edge (for resize cursors). */
  private get topAngle(): number {
    return Math.atan2(this.corners[1].y - this.corners[0].y, this.corners[1].x - this.corners[0].x);
  }

  cursorFor(hit: TransformHit, ctrl: boolean): string {
    if (hit.type === 'rotate' || hit.type === 'outside') return 'grab';
    if (hit.type === 'body') return 'move';
    if (ctrl) return 'crosshair';
    return handleCursor(hit.handle, this.topAngle);
  }

  beginDrag(hit: TransformHit, at: Point, mode: TransformMode): void {
    this.drag = { hit, from: at, start: this.corners, mode };
  }

  dragTo(p: Point, mods: { shift: boolean; alt: boolean; ctrl: boolean }): void {
    const d = this.drag;
    if (!d) return;
    const { w, h } = this.src;
    if (d.hit.type === 'body') {
      let dx = p.x - d.from.x;
      let dy = p.y - d.from.y;
      if (mods.shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      this.corners = moveQuad(d.start, dx, dy);
    } else if (d.hit.type === 'rotate' || d.hit.type === 'outside') {
      this.corners = rotateQuad(d.start, w, h, d.from, p, mods.shift);
    } else {
      this.corners = dragHandle(d.start, w, h, d.hit.handle, d.from, p, d.mode, mods);
    }
    this.onChange?.();
  }

  endDrag(): void {
    this.drag = null;
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  nudge(dx: number, dy: number): void {
    this.corners = moveQuad(this.corners, dx, dy);
    this.onChange?.();
  }

  flip(axis: 'h' | 'v'): void {
    this.corners = flipQuad(this.corners, axis);
    this.onChange?.();
  }

  /** Rotate the corners about the centre (quarter turns or any angle in radians). */
  rotateBy(rad: number): void {
    const c = quadCentre(this.corners, this.src.w, this.src.h);
    this.corners = mapQuad(matChain(matTranslate(-c.x, -c.y), matRotate(rad), matTranslate(c.x, c.y)), this.corners);
    this.onChange?.();
  }

  params(): TransformParams {
    return paramsFromAffine(fitAffine(this.src.w, this.src.h, this.corners), this.src.w, this.src.h);
  }

  setParams(change: Partial<TransformParams>): void {
    this.corners = quadWithParams(this.corners, this.src.w, this.src.h, change);
    this.onChange?.();
  }

  info(): TransformInfo {
    const p = this.params();
    const deg = (r: number) => (r * 180) / Math.PI;
    return { x: p.cx, y: p.cy, w: p.sx * 100, h: p.sy * 100, angle: deg(p.angle), skew: deg(p.skew), distorted: !quadIsAffine(this.corners, 1e-4) };
  }

  drawOverlay(ov: Overlay): void {
    const screen = (q: Point) => ov.toScreen(q);
    if (!this.wholeLayer) ov.antsMany(this.transformedOutline());
    ov.outlineScreen(this.corners.map(screen), true, false);
    const top = screen(handlePoint(this.corners, 'n'));
    const rot = this.rotateHandle(screen);
    ov.line(top, rot);
    for (const h of QUAD_HANDLES) ov.handle(screen(handlePoint(this.corners, h)), 'square', this.drag?.hit.type === 'handle' && this.drag.hit.handle === h);
    ov.handle(rot, 'circle');
  }

  dispose(): void {
    // Canvases are garbage collected.
  }
}
