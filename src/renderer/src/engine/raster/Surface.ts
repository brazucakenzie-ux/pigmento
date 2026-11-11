import type { RGBA } from '../core/color';
import { rectIntersect, type Rect } from '../core/geometry';
import {
  applyColorMask,
  applyImage,
  copyRect,
  fillRectView,
  invertView,
  type MaskView,
  type PixelOp,
  type PixelView,
} from './pixels';

export const TILE_SIZE = 256;
const TILE_BYTES = TILE_SIZE * TILE_SIZE * 4;

export type Tile = Uint8ClampedArray;

function tilesEqual(a: Tile | null, b: Tile | null): boolean {
  if (a === b) return true;
  if (!a) return isZero(b!);
  if (!b) return isZero(a);
  // Compare 32 bits at a time.
  const a32 = new Uint32Array(a.buffer, a.byteOffset, a.length >> 2);
  const b32 = new Uint32Array(b.buffer, b.byteOffset, b.length >> 2);
  for (let i = 0; i < a32.length; i++) if (a32[i] !== b32[i]) return false;
  return true;
}

function isZero(t: Tile): boolean {
  const t32 = new Uint32Array(t.buffer, t.byteOffset, t.length >> 2);
  for (let i = 0; i < t32.length; i++) if (t32[i] !== 0) return false;
  return true;
}

/**
 * Changed tiles of one edit. Holds the *other* version of each tile; `swap` exchanges it with
 * the surface's current tile, so the same delta performs both undo and redo.
 */
export class TileDelta {
  constructor(
    readonly surface: Surface,
    private readonly tiles: Map<number, Tile | null>,
  ) {}

  get size(): number {
    return this.tiles.size;
  }

  get bytes(): number {
    let n = 0;
    for (const t of this.tiles.values()) if (t) n += t.byteLength;
    return n + this.tiles.size * 16;
  }

  /** Swap stored tiles with the surface's; returns the affected area. */
  swap(): Rect | null {
    let bounds: Rect | null = null;
    for (const [i, t] of this.tiles) {
      const cur = this.surface.tiles[i];
      this.surface.tiles[i] = t;
      this.tiles.set(i, cur);
      const r = this.surface.tileRect(i);
      bounds = bounds
        ? {
            x: Math.min(bounds.x, r.x),
            y: Math.min(bounds.y, r.y),
            w: Math.max(bounds.x + bounds.w, r.x + r.w) - Math.min(bounds.x, r.x),
            h: Math.max(bounds.y + bounds.h, r.y + r.h) - Math.min(bounds.y, r.y),
          }
        : r;
    }
    return bounds;
  }
}

/**
 * RGBA8 raster split into 256×256 tiles. `null` tiles are fully transparent.
 * Writes inside beginEdit()/endEdit() are copy-on-write so the edit can be undone cheaply.
 */
export class Surface {
  readonly cols: number;
  readonly rows: number;
  tiles: (Tile | null)[];
  private edit: Map<number, Tile | null> | null = null;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    if (!(width >= 1 && height >= 1)) throw new Error(`Invalid surface size ${width}×${height}`);
    this.cols = Math.ceil(width / TILE_SIZE);
    this.rows = Math.ceil(height / TILE_SIZE);
    this.tiles = new Array<Tile | null>(this.cols * this.rows).fill(null);
  }

  static fromRGBA(width: number, height: number, data: Uint8ClampedArray): Surface {
    const s = new Surface(width, height);
    s.writeRect({ x: 0, y: 0, w: width, h: height }, { data, stride: width, ox: 0, oy: 0 });
    s.compact();
    return s;
  }

  get bounds(): Rect {
    return { x: 0, y: 0, w: this.width, h: this.height };
  }

  tileRect(i: number): Rect {
    const tx = i % this.cols;
    const ty = (i / this.cols) | 0;
    const x = tx * TILE_SIZE;
    const y = ty * TILE_SIZE;
    return { x, y, w: Math.min(TILE_SIZE, this.width - x), h: Math.min(TILE_SIZE, this.height - y) };
  }

  tileView(i: number, tile: Tile): PixelView {
    return {
      data: tile,
      stride: TILE_SIZE,
      ox: (i % this.cols) * TILE_SIZE,
      oy: ((i / this.cols) | 0) * TILE_SIZE,
    };
  }

  get isEditing(): boolean {
    return this.edit !== null;
  }

  beginEdit(): void {
    if (this.edit) throw new Error('Surface edit already in progress');
    this.edit = new Map();
  }

  /** Ends the edit; returns only the tiles whose pixels actually changed. */
  endEdit(): TileDelta | null {
    const log = this.edit;
    this.edit = null;
    if (!log) return null;
    for (const [i, before] of log) {
      const after = this.tiles[i];
      if (tilesEqual(before, after)) {
        log.delete(i);
        this.tiles[i] = before;
      } else if (after && isZero(after)) {
        this.tiles[i] = null;
      }
    }
    return log.size > 0 ? new TileDelta(this, log) : null;
  }

  /** Discard an in-progress edit, restoring the original tiles. */
  abortEdit(): void {
    const log = this.edit;
    this.edit = null;
    if (!log) return;
    for (const [i, before] of log) this.tiles[i] = before;
  }

  /** Returns a tile that may be written, copying it first when an edit is being recorded. */
  private writable(i: number): Tile {
    const cur = this.tiles[i];
    if (this.edit && !this.edit.has(i)) {
      this.edit.set(i, cur);
      const copy = cur ? cur.slice() : new Uint8ClampedArray(TILE_BYTES);
      this.tiles[i] = copy;
      return copy;
    }
    if (cur) return cur;
    const fresh = new Uint8ClampedArray(TILE_BYTES);
    this.tiles[i] = fresh;
    return fresh;
  }

  /**
   * Visit tiles overlapping r with the clipped sub-rect. When `write` is set the tile is made
   * writable; `skipEmpty` skips transparent tiles (useful for erase-like ops).
   */
  forEachTile(
    r: Rect,
    fn: (view: PixelView, sub: Rect, index: number) => void,
    write: boolean,
    skipEmpty = false,
  ): void {
    const c = rectIntersect(r, this.bounds);
    if (!c) return;
    const tx0 = Math.floor(c.x / TILE_SIZE);
    const ty0 = Math.floor(c.y / TILE_SIZE);
    const tx1 = Math.floor((c.x + c.w - 1) / TILE_SIZE);
    const ty1 = Math.floor((c.y + c.h - 1) / TILE_SIZE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * this.cols + tx;
        if (skipEmpty && !this.tiles[i]) continue;
        const sub = rectIntersect(c, this.tileRect(i))!;
        let tile = this.tiles[i];
        if (write) tile = this.writable(i);
        if (!tile) continue;
        fn(this.tileView(i, tile), sub, i);
      }
    }
  }

  getPixel(x: number, y: number): RGBA {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return { r: 0, g: 0, b: 0, a: 0 };
    const tx = (x / TILE_SIZE) | 0;
    const ty = (y / TILE_SIZE) | 0;
    const t = this.tiles[ty * this.cols + tx];
    if (!t) return { r: 0, g: 0, b: 0, a: 0 };
    const i = ((y - ty * TILE_SIZE) * TILE_SIZE + (x - tx * TILE_SIZE)) * 4;
    return { r: t[i], g: t[i + 1], b: t[i + 2], a: t[i + 3] };
  }

  /** Copy pixels of r (any rect, may extend beyond the surface) into a new buffer. */
  readRect(r: Rect, out?: Uint8ClampedArray): Uint8ClampedArray {
    const buf = out ?? new Uint8ClampedArray(r.w * r.h * 4);
    if (out) buf.fill(0);
    const dst: PixelView = { data: buf, stride: r.w, ox: r.x, oy: r.y };
    this.forEachTile(r, (view, sub) => copyRect(dst, view, sub), false);
    return buf;
  }

  toRGBA(): Uint8ClampedArray {
    return this.readRect(this.bounds);
  }

  /** Replace pixels of r with those from src. */
  writeRect(r: Rect, src: PixelView): void {
    this.forEachTile(r, (view, sub) => copyRect(view, src, sub), true);
  }

  fillRect(r: Rect, c: RGBA): void {
    this.forEachTile(r, (view, sub) => fillRectView(view, sub, c), true);
  }

  clearRect(r: Rect, clip?: MaskView | null): void {
    if (!clip) {
      this.forEachTile(r, (view, sub) => fillRectView(view, sub, { r: 0, g: 0, b: 0, a: 0 }), true, true);
      return;
    }
    this.forEachTile(
      r,
      (view, sub) => applyColorMask(view, sub, { r: 0, g: 0, b: 0, a: 255 }, clip, 'erase', 1),
      true,
      true,
    );
  }

  compositeColor(
    r: Rect,
    color: RGBA,
    mask: MaskView | null,
    op: PixelOp,
    opacity: number,
    clip?: MaskView | null,
  ): void {
    this.forEachTile(
      r,
      (view, sub) => applyColorMask(view, sub, color, mask, op, opacity, clip),
      true,
      op === 'erase',
    );
  }

  compositeImage(r: Rect, src: PixelView, op: PixelOp, opacity = 1, clip?: MaskView | null): void {
    this.forEachTile(
      r,
      (view, sub) => applyImage(view, sub, src, op, opacity, clip),
      true,
      op === 'erase',
    );
  }

  invert(r: Rect, clip?: MaskView | null): void {
    this.forEachTile(r, (view, sub) => invertView(view, sub, clip), true, true);
  }

  /** Free tiles that are fully transparent. */
  compact(): void {
    if (this.edit) return;
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (t && isZero(t)) this.tiles[i] = null;
    }
  }

  /**
   * A read-only view of the pixels as they are now, sharing tiles (no copying). It stays
   * unchanged while this surface is written only inside an edit (beginEdit copies a tile
   * before its first write), e.g. the source for cloning during a stroke.
   */
  snapshot(): Surface {
    const s = new Surface(this.width, this.height);
    s.tiles = [...this.tiles];
    return s;
  }

  clone(): Surface {
    const s = new Surface(this.width, this.height);
    s.tiles = this.tiles.map((t) => (t ? t.slice() : null));
    return s;
  }

  get bytes(): number {
    let n = 0;
    for (const t of this.tiles) if (t) n += t.byteLength;
    return n;
  }

  /** Bounds of non-transparent pixels, or null if the surface is empty. */
  contentBounds(): Rect | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    this.forEachTile(
      this.bounds,
      (view, sub) => {
        for (let y = sub.y; y < sub.y + sub.h; y++) {
          let i = ((y - view.oy) * view.stride + (sub.x - view.ox)) * 4 + 3;
          for (let x = sub.x; x < sub.x + sub.w; x++, i += 4) {
            if (view.data[i] !== 0) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
      },
      false,
      true,
    );
    if (x1 < x0) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
}
