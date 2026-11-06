import type { RGBA } from '../core/color';
import { rectCorners, rectIntersect, rectRoundOut, type Point, type Rect } from '../core/geometry';
import {
  matApplyPoints,
  matApplyRect,
  matChain,
  matIsIntegerTranslation,
  matRotate,
  matScale,
  matTranslate,
  type Mat,
} from '../core/matrix';
import { Selection } from '../doc/Selection';
import type { Overlay } from '../render/Overlay';
import { applyColorMask, type MaskView, type PixelView } from '../raster/pixels';
import type { Surface } from '../raster/Surface';
import {
  affineTransform,
  flipH,
  flipV,
  keyOutColor,
  resample,
  rotate90,
  type ImageBuf,
  type TransformedImage,
} from '../raster/transform';
import type { I18nKey } from '../../i18n';
import {
  boxContains,
  boxCorners,
  handleCursor,
  handlePosition,
  hitHandle,
  moveBox,
  resizeBox,
  rotateBox,
  RESIZE_HANDLES,
  type BoxGeom,
  type BoxHandle,
} from './BoxGeom';
import type { LiveObject } from './LiveObject';

export type FloatHit = { type: 'handle'; handle: BoxHandle } | { type: 'body' };

/**
 * Pixels lifted from the layer (or pasted) that can be moved, scaled, rotated and flipped
 * before being dropped back. A lifted float leaves a hole (shown via the layer filter) which is
 * cleared on commit together with placing the pixels, as one undo step.
 */
export class FloatObject implements LiveObject {
  readonly kind = 'float' as const;
  readonly lifted = true;
  historyLabel: I18nKey;
  src: ImageBuf;
  geom: BoxGeom;
  /** Outline polygon(s) in source pixel coordinates (for ants and the resulting selection). */
  outline: Point[][];
  private display: OffscreenCanvas;
  private keyColor: RGBA | null = null;
  private dragStart: { geom: BoxGeom; at: Point; hit: FloatHit } | null = null;
  /** Commit even if nothing moved (paste, delete). */
  forceCommit: boolean;

  constructor(
    src: ImageBuf,
    origin: Point,
    outline: Point[][],
    public hole: MaskView | null,
    label: I18nKey,
    private docW: number,
    private docH: number,
    /** Coverage of a soft or multi-part selection, as an image whose alpha is the mask (same size as src). */
    private maskImg: ImageBuf | null = null,
  ) {
    this.src = src;
    this.outline = outline;
    this.geom = { cx: origin.x + src.w / 2, cy: origin.y + src.h / 2, w: src.w, h: src.h, angle: 0 };
    this.historyLabel = label;
    this.forceCommit = hole === null;
    this.display = new OffscreenCanvas(src.w, src.h);
    this.refreshDisplay();
  }

  /** Source pixels → document transform. */
  matrix(): Mat {
    const g = this.geom;
    return matChain(
      matTranslate(-this.src.w / 2, -this.src.h / 2),
      matScale(g.w / this.src.w, g.h / this.src.h),
      matRotate(g.angle),
      matTranslate(g.cx, g.cy),
    );
  }

  get isIdentityPlacement(): boolean {
    return (
      this.hole !== null &&
      !this.forceCommit &&
      matIsIntegerTranslation(this.matrix()) &&
      Math.abs(this.geom.cx - this.src.w / 2 - this.hole.ox) < 1e-6 &&
      Math.abs(this.geom.cy - this.src.h / 2 - this.hole.oy) < 1e-6
    );
  }

  setKeyColor(c: RGBA | null): void {
    this.keyColor = c;
    this.refreshDisplay();
  }

  /** Pixels as displayed (transparent-selection key applied). */
  private keyed(): ImageBuf {
    if (!this.keyColor) return this.src;
    const img = { w: this.src.w, h: this.src.h, data: this.src.data.slice() };
    keyOutColor(img, this.keyColor);
    return img;
  }

  private refreshDisplay(): void {
    if (this.display.width !== this.src.w || this.display.height !== this.src.h) {
      this.display = new OffscreenCanvas(this.src.w, this.src.h);
    }
    const ctx = this.display.getContext('2d')!;
    const k = this.keyed();
    ctx.putImageData(new ImageData(k.data as Uint8ClampedArray<ArrayBuffer>, k.w, k.h), 0, 0);
  }

  bounds(): Rect | null {
    return rectIntersect(rectRoundOut(matApplyRect(this.matrix(), { x: 0, y: 0, w: this.src.w, h: this.src.h })), {
      x: 0,
      y: 0,
      w: this.docW,
      h: this.docH,
    });
  }

  /** Whole placed area, including any part outside the canvas. */
  extent(): Rect {
    return rectRoundOut(matApplyRect(this.matrix(), { x: 0, y: 0, w: this.src.w, h: this.src.h }));
  }

  /** The canvas was reframed: its old (dx, dy) offset is the new origin, and its size is docW×docH. */
  reframe(dx: number, dy: number, docW: number, docH: number): void {
    this.geom = { ...this.geom, cx: this.geom.cx + dx, cy: this.geom.cy + dy };
    if (this.hole) this.hole = { ...this.hole, ox: this.hole.ox + dx, oy: this.hole.oy + dy };
    this.docW = docW;
    this.docH = docH;
  }

  filterBounds(): Rect | null {
    if (!this.hole) return null;
    return { x: this.hole.ox, y: this.hole.oy, w: this.hole.w, h: this.hole.h };
  }

  /** Clears the lifted area in the active layer's display. */
  layerFilter = (view: PixelView, r: Rect): void => {
    if (!this.hole) return;
    const hb = rectIntersect(r, { x: this.hole.ox, y: this.hole.oy, w: this.hole.w, h: this.hole.h });
    if (hb) applyColorMask(view, hb, { r: 0, g: 0, b: 0, a: 255 }, this.hole, 'erase', 1);
  };

  draw(ctx: OffscreenCanvasRenderingContext2D): void {
    const m = this.matrix();
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.imageSmoothingEnabled = !matIsIntegerTranslation(m);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.display, 0, 0);
    ctx.restore();
  }

  /** Final pixels in document space. */
  rendered(clipToDoc = true): TransformedImage {
    const m = this.matrix();
    const k = this.keyed();
    if (matIsIntegerTranslation(m)) {
      return { x: Math.round(m[4]), y: Math.round(m[5]), w: k.w, h: k.h, data: k.data };
    }
    return affineTransform(k, m, true, clipToDoc ? { x: 0, y: 0, w: this.docW, h: this.docH } : undefined);
  }

  rasterize(surface: Surface): void {
    if (this.hole) {
      surface.clearRect({ x: this.hole.ox, y: this.hole.oy, w: this.hole.w, h: this.hole.h }, this.hole);
    }
    const img = this.rendered();
    if (img.w === 0 || img.h === 0) return;
    surface.compositeImage(
      { x: img.x, y: img.y, w: img.w, h: img.h },
      { data: img.data, stride: img.w, ox: img.x, oy: img.y },
      'over',
    );
  }

  /** The selection outline after transformation (document space). */
  transformedOutline(): Point[][] {
    const m = this.matrix();
    return this.outline.map((poly) => matApplyPoints(m, poly));
  }

  /** Hand over to free transform: the pixels (with any colour keyed out) and where they are now. */
  transformSource(): { src: ImageBuf; corners: [Point, Point, Point, Point]; outline: Point[][]; hole: MaskView | null; maskImg: ImageBuf; forceCommit: boolean } {
    const m = this.matrix();
    const { w, h } = this.src;
    const corners = matApplyPoints(m, rectCorners({ x: 0, y: 0, w, h })) as [Point, Point, Point, Point];
    let maskImg = this.maskImg;
    if (!maskImg) {
      maskImg = { w, h, data: new Uint8ClampedArray(w * h * 4) };
      for (let i = 3; i < maskImg.data.length; i += 4) maskImg.data[i] = 255;
    }
    return { src: this.keyed(), corners, outline: this.outline, hole: this.hole, maskImg, forceCommit: !this.isIdentityPlacement };
  }

  /** The travelling mask placed in document space (like `rendered(false)`), or null. */
  renderedMask(): TransformedImage | null {
    if (!this.maskImg) return null;
    const m = this.matrix();
    if (matIsIntegerTranslation(m)) return { x: Math.round(m[4]), y: Math.round(m[5]), ...this.maskImg };
    return affineTransform(this.maskImg, m, true);
  }

  selectionAfterCommit(): Selection | null {
    const outlines = this.transformedOutline();
    const m = this.matrix();
    const placed = this.renderedMask();
    if (placed) {
      const mask = new Uint8Array(placed.w * placed.h);
      for (let i = 0; i < mask.length; i++) mask[i] = placed.data[i * 4 + 3];
      const sel = Selection.fromMask({ x: placed.x, y: placed.y, w: placed.w, h: placed.h }, mask, outlines, 'mask');
      return sel ? sel.clipped(this.docW, this.docH) : null;
    }
    if (matIsIntegerTranslation(m) && this.outline.length === 1 && this.outline[0].length === 4) {
      const b = rectRoundOut(matApplyRect(m, { x: 0, y: 0, w: this.src.w, h: this.src.h }));
      return Selection.fromRect(b, this.docW, this.docH);
    }
    return Selection.fromPolygon(outlines[0], this.docW, this.docH);
  }

  // ---- editing -------------------------------------------------------------------------

  hit(p: Point, sp: Point, screen: (q: Point) => Point, zoom: number): FloatHit | null {
    const h = hitHandle(this.geom, screen, sp, zoom, true);
    if (h) return { type: 'handle', handle: h };
    return boxContains(this.geom, p) ? { type: 'body' } : null;
  }

  cursorFor(hit: FloatHit | null): string | null {
    if (!hit) return null;
    return hit.type === 'body' ? 'move' : handleCursor(hit.handle, this.geom.angle);
  }

  beginDrag(hit: FloatHit, at: Point): void {
    this.dragStart = { geom: { ...this.geom }, at, hit };
  }

  drag(p: Point, mods: { shift: boolean; alt: boolean }): void {
    const d = this.dragStart;
    if (!d) return;
    if (d.hit.type === 'body') {
      // Whole-pixel moves keep the pixels crisp.
      this.geom = moveBox(d.geom, Math.round(p.x - d.at.x), Math.round(p.y - d.at.y));
    } else if (d.hit.handle === 'rotate') {
      this.geom = rotateBox(d.geom, d.at, p, mods.shift);
    } else {
      this.geom = resizeBox(d.geom, d.hit.handle, p, { keepAspect: mods.shift, fromCenter: mods.alt });
    }
  }

  endDrag(): void {
    this.dragStart = null;
  }

  nudge(dx: number, dy: number): void {
    this.geom = moveBox(this.geom, dx, dy);
  }

  moveTo(x: number, y: number): void {
    this.geom = { ...this.geom, cx: x + Math.abs(this.geom.w) / 2, cy: y + Math.abs(this.geom.h) / 2 };
  }

  flip(axis: 'h' | 'v'): void {
    this.src = axis === 'h' ? flipH(this.src) : flipV(this.src);
    if (this.maskImg) this.maskImg = axis === 'h' ? flipH(this.maskImg) : flipV(this.maskImg);
    const W = this.src.w;
    const H = this.src.h;
    this.outline = this.outline.map((poly) => poly.map((q) => (axis === 'h' ? { x: W - q.x, y: q.y } : { x: q.x, y: H - q.y })));
    this.forceCommit = true;
    this.refreshDisplay();
  }

  rotateQuarter(q: number): void {
    const turns = ((q % 4) + 4) % 4;
    const W = this.src.w;
    const H = this.src.h;
    this.src = rotate90(this.src, turns);
    if (this.maskImg) this.maskImg = rotate90(this.maskImg, turns);
    this.outline = this.outline.map((poly) =>
      poly.map((p) => (turns === 1 ? { x: H - p.y, y: p.x } : turns === 2 ? { x: W - p.x, y: H - p.y } : turns === 3 ? { x: p.y, y: W - p.x } : p)),
    );
    if (turns % 2 === 1) {
      const sx = this.geom.w / W;
      const sy = this.geom.h / H;
      this.geom = { ...this.geom, w: this.src.w * sy, h: this.src.h * sx };
    }
    this.forceCommit = true;
    this.refreshDisplay();
  }

  /**
   * Replace the float with already-transformed document-space pixels (used by skew and free
   * rotation). `outline` is in document coordinates.
   */
  resetTo(img: TransformedImage, outline: Point[][], mask: ImageBuf | null = null): void {
    this.src = { w: img.w, h: img.h, data: img.data };
    if (this.maskImg) this.maskImg = mask;
    this.outline = outline.map((poly) => poly.map((p) => ({ x: p.x - img.x, y: p.y - img.y })));
    this.geom = { cx: img.x + img.w / 2, cy: img.y + img.h / 2, w: img.w, h: img.h, angle: 0 };
    this.forceCommit = true;
    this.refreshDisplay();
  }

  /** Replace pixels (resize dialog) keeping the top-left corner. */
  replacePixels(img: ImageBuf): void {
    const tl = { x: this.geom.cx - Math.abs(this.geom.w) / 2, y: this.geom.cy - Math.abs(this.geom.h) / 2 };
    const sx = img.w / this.src.w;
    const sy = img.h / this.src.h;
    this.outline = this.outline.map((poly) => poly.map((p) => ({ x: p.x * sx, y: p.y * sy })));
    if (this.maskImg) this.maskImg = resample(this.maskImg, img.w, img.h, 'bilinear');
    this.src = img;
    this.geom = { cx: tl.x + img.w / 2, cy: tl.y + img.h / 2, w: img.w, h: img.h, angle: this.geom.angle };
    this.forceCommit = true;
    this.refreshDisplay();
  }

  drawOverlay(ov: Overlay): void {
    const screen = (q: Point) => ov.toScreen(q);
    ov.antsMany(this.transformedOutline());
    const zoom = ov.view.zoom;
    ov.outlineScreen(boxCorners(this.geom).map(screen), true, true);
    const top = screen(handlePosition(this.geom, 'n', zoom));
    const rot = screen(handlePosition(this.geom, 'rotate', zoom));
    ov.line(top, rot);
    for (const h of RESIZE_HANDLES) ov.handle(screen(handlePosition(this.geom, h, zoom)));
    ov.handle(rot, 'circle');
  }

  cursorAt(): string | null {
    return null;
  }

  dispose(): void {
    // Canvases are garbage collected.
  }
}

export function rectOutline(w: number, h: number): Point[][] {
  return [rectCorners({ x: 0, y: 0, w, h })];
}
