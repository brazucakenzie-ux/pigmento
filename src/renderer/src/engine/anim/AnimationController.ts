import type { Point, Rect } from '../core/geometry';
import type { PaintDocument, RasterLayer } from '../doc/Document';
import { Surface } from '../raster/Surface';
import { celAt, celIndexAt, celSurfaces, insertCel, MAX_CELS, moveCelStart, removeCelAt, type Cel } from './cels';
import type { Command, History } from '../history/History';
import type { ImageBuf } from '../raster/transform';
import type { I18nKey, I18nParams } from '../../i18n';
import { movePivot, type Easing } from './interpolate';
import { MAX_PIXELS } from '../io/protocol';
import {
  clonePiece,
  makePiece,
  MAX_KEYFRAMES,
  MAX_PIECE_SIDE,
  MAX_PIECES,
  MAX_SCROLL,
  moveKey,
  newPieceId,
  piecesBytes,
  removeKey,
  setKey,
  pieceStateAt,
  type KeyChange,
  type Piece,
  type Repeat,
} from './piece';
import { advance, clampFps, clampFrame, clampLength, type LoopMode, type PlayState, type Timeline } from './timeline';

/** What the animation controller needs from the engine. */
export interface AnimHost {
  readonly doc: PaintDocument;
  readonly history: History;
  commitLive(): void;
  notify(kind: 'info' | 'error', key: I18nKey, params?: I18nParams): void;
  /** Pieces, the timeline or the frame changed: redraw (r = the area, null = everything) and tell the UI. */
  animationChanged(r: Rect | null): void;
}

export interface PieceInfo {
  id: string;
  name: string;
  layerId: string;
  keys: { frame: number; easing: Easing }[];
}

export interface AnimationInfo {
  fps: number;
  length: number;
  loop: LoopMode;
  frame: number;
  pieces: PieceInfo[];
  selectedId: string | null;
  /** The selected piece at the frame shown, for the options bar's number fields. */
  current: PieceFields | null;
  playing: boolean;
  /** Frame-by-frame layers: where each drawing starts (layers not listed are still). */
  cels: Record<string, number[]>;
  /** Painting tools paint on the selected piece instead of the active layer. */
  paintOnPiece: boolean;
}

/** A piece's values as the options bar shows them (degrees and percent). */
export interface PieceFields {
  /** Where the pivot is, in document pixels. */
  x: number;
  y: number;
  /** Scale in percent (negative = flipped). */
  w: number;
  h: number;
  angle: number;
  skew: number;
  opacity: number;
  /** How far its tiles have slid, in its own pixels (a repeating piece). */
  scrollX: number;
  scrollY: number;
  /** Easing from this frame's keyframe (or the one before it) to the next. */
  easing: Easing;
  /** There's a keyframe at this frame. */
  keyed: boolean;
  /** That keyframe bends the motion path. */
  curved: boolean;
  /** Which way copies of it tile on (not keyframed). */
  repeat: Repeat;
}

const DEG = 180 / Math.PI;

/** Everything about the animation an undo step can change (not the frame shown). */
export interface AnimSnapshot {
  pieces: Piece[];
  fps: number;
  length: number;
  loop: LoopMode;
}

export function captureAnim(doc: PaintDocument): AnimSnapshot {
  const t = doc.timeline;
  return { pieces: doc.pieces.map(clonePiece), fps: t.fps, length: t.length, loop: t.loop };
}

export function restoreAnim(doc: PaintDocument, s: AnimSnapshot): void {
  doc.pieces = s.pieces.map(clonePiece);
  doc.timeline.fps = s.fps;
  doc.timeline.length = s.length;
  doc.timeline.loop = s.loop;
  doc.timeline.frame = clampFrame(doc.timeline.frame, s.length);
  doc.showFrame(doc.timeline.frame);
}

/** One undoable change to the pieces or the timeline. */
export class AnimationCommand implements Command {
  readonly bytes: number;

  constructor(
    readonly label: I18nKey,
    private readonly host: AnimHost,
    private readonly before: AnimSnapshot,
    private readonly after: AnimSnapshot,
  ) {
    // Source images are shared between snapshots; count one only when this step adds or removes it.
    const ids = (s: AnimSnapshot) => new Set(s.pieces.map((p) => p.src));
    const a = ids(before);
    const b = ids(after);
    let src = 0;
    for (const s of a) if (!b.has(s)) src += s.bytes;
    for (const s of b) if (!a.has(s)) src += s.bytes;
    this.bytes = piecesBytes(before.pieces) + piecesBytes(after.pieces) + src;
  }

  undo(): void {
    restoreAnim(this.host.doc, this.before);
    this.host.animationChanged(null);
  }

  redo(): void {
    restoreAnim(this.host.doc, this.after);
    this.host.animationChanged(null);
  }
}

/**
 * Pieces, keyframes and the timeline. Every change is one undo step; a drag (begin → preview …
 * → end) is one step too, however many times it previews.
 */
export class AnimationController {
  selectedId: string | null = null;
  /** Default names for new pieces, supplied by the UI (the engine never stores English text). */
  namer: (n: number) => string = () => '';
  private drag: AnimSnapshot | null = null;
  /** Paint on piece: painting tools paint the selected piece's own pixels (view state, not undoable). */
  private paintOn = false;

  constructor(private readonly host: AnimHost) {}

  private get doc(): PaintDocument {
    return this.host.doc;
  }

  get timeline(): Readonly<Timeline> {
    return this.doc.timeline;
  }

  get frame(): number {
    return this.doc.timeline.frame;
  }

  piece(id: string | null): Piece | null {
    return id ? (this.doc.pieces.find((p) => p.id === id) ?? null) : null;
  }

  get selected(): Piece | null {
    return this.piece(this.selectedId);
  }

  /** True once the picture has anything that moves. */
  get animated(): boolean {
    return this.doc.pieces.length > 0 || this.doc.hasCels;
  }

  get paintOnPiece(): boolean {
    return this.paintOn;
  }

  setPaintOnPiece(on: boolean): void {
    if (on === this.paintOn) return;
    this.paintOn = on;
    this.host.animationChanged(null);
  }

  /** The piece painting tools paint on (Paint on piece is on and a piece is selected), or null. */
  get paintTarget(): Piece | null {
    return this.paintOn ? this.selected : null;
  }

  /** True if `p` can be painted on (its layer is showing and unlocked); says why not otherwise. */
  canPaint(p: Piece): boolean {
    const layer = this.doc.layerById(p.layerId);
    if (!layer || layer.locked) {
      this.host.notify('info', 'notice.layerLocked');
      return false;
    }
    if (!this.doc.isEffectivelyVisible(layer.id) || pieceStateAt(p, this.frame).opacity <= 0) {
      this.host.notify('info', 'notice.pieceHidden');
      return false;
    }
    return true;
  }

  info(): AnimationInfo {
    const t = this.doc.timeline;
    return {
      fps: t.fps,
      length: t.length,
      loop: t.loop,
      frame: t.frame,
      selectedId: this.selected ? this.selectedId : null,
      current: this.fields(),
      playing: this.playing,
      cels: Object.fromEntries(this.doc.rasterLayers().flatMap((l) => (l.cels ? [[l.id, l.cels.map((c) => c.start)]] : []))),
      pieces: this.doc.pieces.map((p) => ({ id: p.id, name: p.name, layerId: p.layerId, keys: p.keyframes.map((k) => ({ frame: k.frame, easing: k.easing })) })),
      paintOnPiece: this.paintOn,
    };
  }

  /** The selected piece's values at the current frame. */
  fields(): PieceFields | null {
    const p = this.selected;
    if (!p) return null;
    const f = this.frame;
    const s = pieceStateAt(p, f);
    const at = p.keyframes.find((k) => k.frame === f);
    const before = [...p.keyframes].reverse().find((k) => k.frame <= f) ?? p.keyframes[0];
    return {
      x: s.x,
      y: s.y,
      w: s.sx * 100,
      h: s.sy * 100,
      angle: s.angle * DEG,
      skew: s.skew * DEG,
      opacity: s.opacity * 100,
      scrollX: s.scrollX,
      scrollY: s.scrollY,
      easing: (at ?? before).easing,
      keyed: at !== undefined,
      curved: at !== undefined && (at.in !== null || at.out !== null),
      repeat: p.repeat,
    };
  }

  /** Set the selected piece's values at the current frame (auto-key), in the options bar's units. */
  setFields(change: Partial<Omit<PieceFields, 'keyed' | 'curved' | 'repeat'>>): boolean {
    const p = this.selected;
    if (!p) return false;
    const k: KeyChange = {};
    if (change.x !== undefined) k.x = change.x;
    if (change.y !== undefined) k.y = change.y;
    if (change.w !== undefined) k.sx = nonZero(change.w / 100);
    if (change.h !== undefined) k.sy = nonZero(change.h / 100);
    if (change.angle !== undefined) k.angle = change.angle / DEG;
    if (change.skew !== undefined) k.skew = Math.max(-85, Math.min(85, change.skew)) / DEG;
    if (change.opacity !== undefined) k.opacity = Math.max(0, Math.min(100, change.opacity)) / 100;
    if (change.scrollX !== undefined) k.scrollX = clampScroll(change.scrollX);
    if (change.scrollY !== undefined) k.scrollY = clampScroll(change.scrollY);
    if (change.easing !== undefined) k.easing = change.easing;
    return this.setKey(p.id, this.frame, k);
  }

  /** Which way copies of a piece tile on (one undo step; not keyframed). */
  setRepeat(id: string, repeat: Repeat): boolean {
    const p = this.piece(id);
    if (!p || p.repeat === repeat) return false;
    return this.change('history.pieceRepeat', () => {
      p.repeat = repeat;
      return true;
    });
  }

  /**
   * Scroll a repeating piece by exactly one tile over the timeline (leftwards, or upwards when it
   * repeats only down), so the last frame leads seamlessly back into the first. Every keyframe
   * gets the scroll that steady motion has at its frame; the first and last frames get keyframes.
   */
  loopScroll(id: string): boolean {
    const p = this.piece(id);
    if (!p) return false;
    if (p.repeat === 'none') {
      this.host.notify('info', 'notice.loopNeedsRepeat');
      return false;
    }
    const n = this.doc.timeline.length;
    if (n < 2) {
      this.host.notify('info', 'notice.loopNeedsFrames');
      return false;
    }
    const key = p.repeat === 'y' ? 'scrollY' : 'scrollX';
    const tile = key === 'scrollY' ? p.src.height : p.src.width;
    const start = pieceStateAt(p, 0)[key];
    let keys = p.keyframes;
    for (const f of [0, n - 1]) if (!keys.some((k) => k.frame === f)) keys = setKey(keys, f, {});
    if (keys.length > MAX_KEYFRAMES) {
      this.host.notify('error', 'notice.tooManyKeyframes', { max: MAX_KEYFRAMES });
      return false;
    }
    const next = keys.map((k) => ({ ...k, [key]: start - (k.frame / n) * tile }));
    return this.change('history.loopScroll', () => {
      p.keyframes = next;
      return true;
    });
  }

  /** A new document was loaded (or the old one replaced). */
  reset(): void {
    this.stopTimer();
    this.selectedId = null;
    this.drag = null;
  }

  // ---- playback ---------------------------------------------------------------------------

  private play_: { t0: number; steps: number; pos: PlayState } | null = null;
  private raf = 0;

  get playing(): boolean {
    return this.play_ !== null;
  }

  /** Play from the frame shown at the document's frame rate (frames are skipped if drawing falls behind). */
  play(): void {
    if (this.play_ || typeof requestAnimationFrame !== 'function') return;
    this.host.commitLive();
    const t = this.doc.timeline;
    // A timeline that plays once starts again from the beginning when it's at its end.
    if (t.loop === 'once' && t.frame >= t.length - 1) {
      t.frame = 0;
      this.doc.showFrame(0);
    }
    this.play_ = { t0: performance.now(), steps: 0, pos: { frame: t.frame, dir: 1 } };
    const tick = (now: number): void => {
      const p = this.play_;
      if (!p) return;
      const due = Math.floor(((now - p.t0) / 1000) * this.doc.timeline.fps);
      if (due > p.steps) {
        const next = advance(p.pos, due - p.steps, this.doc.timeline);
        p.steps = due;
        if (!next) {
          this.doc.timeline.frame = this.doc.timeline.length - 1;
          this.doc.showFrame(this.doc.timeline.frame);
          this.stop();
          return;
        }
        p.pos = next;
        this.doc.timeline.frame = next.frame;
        this.doc.showFrame(next.frame);
        this.host.animationChanged(null);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.host.animationChanged(null);
  }

  stop(): void {
    if (!this.play_) return;
    this.stopTimer();
    this.host.animationChanged(null);
  }

  private stopTimer(): void {
    if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.play_ = null;
  }

  togglePlay(): void {
    if (this.playing) this.stop();
    else this.play();
  }

// ---- frame-by-frame drawings (cels) ---------------------------------------------------------

  /** The pixel layer to change drawings on: null (saying why) if it isn't one or is locked. */
  private rasterLayer(id: string): RasterLayer | null {
    const l = this.doc.layerById(id);
    if (l?.kind !== 'raster') return null;
    if (l.locked) {
      this.host.notify('info', 'notice.layerLocked');
      return null;
    }
    return l;
  }

  /** Change one layer's drawings as one undo step (fn returns false when nothing changed). */
  private celChange(label: I18nKey, layer: RasterLayer, fn: () => boolean): boolean {
    this.host.commitLive();
    const before: CelSnapshot = { surface: layer.surface, cels: layer.cels && layer.cels.map((c) => ({ ...c })) };
    if (!fn()) return false;
    // Down to one drawing: the layer is a still layer again.
    if (layer.cels && layer.cels.length === 1) {
      layer.surface = layer.cels[0].surface;
      layer.cels = null;
    }
    layer.showFrame(this.frame);
    const after: CelSnapshot = { surface: layer.surface, cels: layer.cels && layer.cels.map((c) => ({ ...c })) };
    this.host.history.push(new CelCommand(label, this.host, layer, before, after));
    this.host.animationChanged(null);
    return true;
  }

  /** The drawings of `layer`, made frame-by-frame if it's still. */
  private celsOf(layer: RasterLayer): Cel[] {
    return layer.cels ?? [{ start: 0, surface: layer.surface }];
  }

  /**
   * A new drawing on `layerId` starting at the current frame: blank, or a copy of the one shown
   * there (copy-on-write, so copying costs almost nothing until it's drawn on).
   */
  newDrawing(layerId: string, copy: boolean): boolean {
    const layer = this.rasterLayer(layerId);
    if (!layer) return false;
    const frame = this.frame;
    const cels = this.celsOf(layer);
    if (cels.length >= MAX_CELS) {
      this.host.notify('error', 'notice.tooManyCels', { max: MAX_CELS });
      return false;
    }
    if (cels.some((c) => c.start === frame)) {
      this.host.notify('info', 'notice.drawingHere');
      return false;
    }
    const surface = copy ? celAt(cels, frame).surface.clone() : new Surface(this.doc.width, this.doc.height);
    return this.celChange(copy ? 'history.copyDrawing' : 'history.newDrawing', layer, () => {
      const next = insertCel(cels, frame, surface);
      if (!next) return false;
      layer.cels = next;
      return true;
    });
  }

  /** Delete the drawing shown at the current frame (the one before shows on in its place). */
  deleteDrawing(layerId: string): boolean {
    const layer = this.rasterLayer(layerId);
    const next = layer?.cels ? removeCelAt(layer.cels, this.frame) : null;
    if (!layer || !next) return false;
    return this.celChange('history.deleteDrawing', layer, () => {
      layer.cels = next;
      return true;
    });
  }

  /** Empty the drawing shown at the current frame. */
  clearDrawing(layerId: string): boolean {
    const layer = this.rasterLayer(layerId);
    if (!layer || !layer.surface.contentBounds()) return false;
    const blank = new Surface(this.doc.width, this.doc.height);
    return this.celChange('history.clearDrawing', layer, () => {
      if (!layer.cels) {
        layer.surface = blank;
        return true;
      }
      const i = celIndexAt(layer.cels, this.frame);
      layer.cels = layer.cels.map((c, k) => (k === i ? { start: c.start, surface: blank } : { ...c }));
      return true;
    });
  }

  /** Move where drawing `index` starts: the drawing before it is held longer or shorter. */
  moveDrawing(layerId: string, index: number, start: number): boolean {
    const layer = this.rasterLayer(layerId);
    const next = layer?.cels ? moveCelStart(layer.cels, index, clampFrame(start, this.doc.timeline.length)) : null;
    if (!layer || !next) return false;
    return this.celChange('history.holdDrawing', layer, () => {
      layer.cels = next;
      return true;
    });
  }

  /** Frames that have a keyframe: of one piece, or of every piece (sorted, no repeats). */
  keyFrames(id: string | null): number[] {
    const pieces = id ? [this.piece(id)].filter((p): p is Piece => p !== null) : this.doc.pieces;
    return [...new Set(pieces.flatMap((p) => p.keyframes.map((k) => k.frame)))].sort((a, b) => a - b);
  }

  /** Go to the previous (-1) or next (1) keyframe of the selected piece, or of any piece. */
  stepKey(dir: -1 | 1): void {
    const frames = this.keyFrames(this.selected ? this.selectedId : null);
    const f = this.frame;
    const target = dir > 0 ? frames.find((k) => k > f) : [...frames].reverse().find((k) => k < f);
    if (target !== undefined) this.setFrame(target);
  }

  select(id: string | null): void {
    const next = this.piece(id) ? id : null;
    if (next === this.selectedId) return;
    this.selectedId = next;
    this.host.animationChanged(null);
  }

  setFrame(frame: number): void {
    const f = clampFrame(frame, this.doc.timeline.length);
    if (f === this.doc.timeline.frame) return;
    this.host.commitLive();
    this.doc.timeline.frame = f;
    this.doc.showFrame(f);
    this.host.animationChanged(null);
  }

  /** Apply fn as one undo step (fn returns false when nothing changed). */
  private change(label: I18nKey, fn: () => boolean): boolean {
    if (this.drag) return false;
    const before = captureAnim(this.doc);
    if (!fn()) return false;
    const after = captureAnim(this.doc);
    // Setting what's already there isn't a step (a field committed twice, say).
    if (sameAnim(before, after)) return false;
    this.host.history.push(new AnimationCommand(label, this.host, before, after));
    this.host.animationChanged(null);
    return true;
  }

  setTimeline(change: Partial<Pick<Timeline, 'fps' | 'length' | 'loop'>>): boolean {
    const t = this.doc.timeline;
    const fps = change.fps === undefined ? t.fps : clampFps(change.fps);
    const length = change.length === undefined ? t.length : clampLength(change.length);
    const loop = change.loop ?? t.loop;
    if (fps === t.fps && length === t.length && loop === t.loop) return false;
    // Playback keeps its place when the frame rate changes.
    if (this.play_) this.play_ = { t0: performance.now(), steps: 0, pos: { ...this.play_.pos } };
    return this.change('history.timeline', () => {
      t.fps = fps;
      t.length = length;
      t.loop = loop;
      t.frame = clampFrame(t.frame, length);
      this.doc.showFrame(t.frame);
      return true;
    });
  }

  /** False (and says so) when the picture already has the most pieces it can. */
  canAdd(): boolean {
    if (this.doc.pieces.length < MAX_PIECES) return true;
    this.host.notify('error', 'notice.tooManyPieces', { max: MAX_PIECES });
    return false;
  }

  /** False (and says so) when a w × h piece would be bigger than a piece can be. */
  fits(w: number, h: number): boolean {
    if (w <= MAX_PIECE_SIDE && h <= MAX_PIECE_SIDE && w * h <= MAX_PIXELS) return true;
    this.host.notify('error', 'notice.pieceTooBig', { max: MAX_PIECE_SIDE });
    return false;
  }

  /**
   * Add a piece made from `src`, lifted from (or placed at) `home` on layer `layerId`, with a
   * keyframe at the current frame. It goes on top of the layer's pieces, or under them with
   * `atBottom` (a whole layer's pixels made a piece keep their place under its other pieces).
   */
  add(src: ImageBuf | Surface, home: Rect, layerId: string, label: I18nKey = 'history.animateSelection', atBottom = false): Piece | null {
    const size = src instanceof Surface ? { w: src.width, h: src.height } : src;
    if (!this.canAdd() || !this.fits(size.w, size.h)) return null;
    const n = this.doc.pieces.length + 1;
    const piece = makePiece(newPieceId(), this.namer(n), layerId, src, home, this.frame);
    this.change(label, () => {
      const first = atBottom ? this.doc.pieces.findIndex((p) => p.layerId === layerId) : -1;
      if (first >= 0) this.doc.pieces.splice(first, 0, piece);
      else this.doc.pieces.push(piece);
      return true;
    });
    this.selectedId = piece.id;
    this.host.animationChanged(null);
    return this.piece(piece.id);
  }

  rename(id: string, name: string): boolean {
    const p = this.piece(id);
    const next = name.trim().slice(0, 200);
    if (!p || next === p.name) return false;
    return this.change('history.pieceRename', () => {
      p.name = next;
      return true;
    });
  }

  remove(id: string): boolean {
    const i = this.doc.pieces.findIndex((p) => p.id === id);
    if (i < 0) return false;
    const done = this.change('history.pieceDelete', () => {
      this.doc.pieces.splice(i, 1);
      return true;
    });
    if (this.selectedId === id) this.selectedId = null;
    return done;
  }

  /** Set values at `frame` (adding a keyframe there if there isn't one). */
  setKey(id: string, frame: number, change: KeyChange): boolean {
    const p = this.piece(id);
    if (!p) return false;
    const adding = !p.keyframes.some((k) => k.frame === frame);
    if (adding && p.keyframes.length >= MAX_KEYFRAMES) {
      this.host.notify('error', 'notice.tooManyKeyframes', { max: MAX_KEYFRAMES });
      return false;
    }
    return this.change(adding ? 'history.keyframeAdd' : 'history.keyframe', () => {
      p.keyframes = setKey(p.keyframes, frame, change);
      return true;
    });
  }

/** Make the motion path straight again at the keyframe at `frame`. */
  straighten(id: string, frame: number): boolean {
    const p = this.piece(id);
    const k = p?.keyframes.find((q) => q.frame === frame);
    if (!p || !k || (k.in === null && k.out === null)) return false;
    return this.change('history.straighten', () => {
      p.keyframes = setKey(p.keyframes, frame, { in: null, out: null });
      return true;
    });
  }

  removeKey(id: string, frame: number): boolean {
    const p = this.piece(id);
    const next = p && removeKey(p.keyframes, frame);
    if (!p || !next) return false;
    return this.change('history.keyframeDelete', () => {
      p.keyframes = next;
      return true;
    });
  }

  moveKey(id: string, from: number, to: number): boolean {
    const p = this.piece(id);
    const target = clampFrame(to, this.doc.timeline.length);
    const next = p && target !== from ? moveKey(p.keyframes, from, target) : null;
    if (!p || !next) return false;
    return this.change('history.keyframeMove', () => {
      p.keyframes = next;
      return true;
    });
  }

  /** Move the pivot (source pixels) without moving the piece on any keyframe. */
  setPivot(id: string, pivot: Point): boolean {
    const p = this.piece(id);
    if (!p || (pivot.x === p.pivot.x && pivot.y === p.pivot.y)) return false;
    return this.change('history.pivot', () => {
      p.keyframes = movePivot(p.keyframes, p.pivot, pivot);
      p.pivot = { ...pivot };
      return true;
    });
  }

  // ---- drags: many previews, one undo step ----------------------------------------------

  get dragging(): boolean {
    return this.drag !== null;
  }

  beginDrag(): void {
    this.drag = captureAnim(this.doc);
  }

  /** Change a piece live during a drag (no undo step yet). */
  preview(id: string, fn: (p: Piece) => void): void {
    const p = this.piece(id);
    if (!this.drag || !p) return;
    fn(p);
    this.host.animationChanged(null);
  }

  endDrag(label: I18nKey): boolean {
    const before = this.drag;
    this.drag = null;
    if (!before) return false;
    const after = captureAnim(this.doc);
    if (sameAnim(before, after)) return false;
    this.host.history.push(new AnimationCommand(label, this.host, before, after));
    this.host.animationChanged(null);
    return true;
  }

  cancelDrag(): void {
    if (!this.drag) return;
    restoreAnim(this.doc, this.drag);
    this.drag = null;
    this.host.animationChanged(null);
  }
}

/** Two snapshots hold the same animation (pixels are compared by identity). */
function sameAnim(a: AnimSnapshot, b: AnimSnapshot): boolean {
  if (a.fps !== b.fps || a.length !== b.length || a.loop !== b.loop || a.pieces.length !== b.pieces.length) return false;
  if (a.pieces.some((p, i) => p.src !== b.pieces[i].src)) return false;
  return JSON.stringify(a.pieces.map(strip)) === JSON.stringify(b.pieces.map(strip));
}

/** A piece without its pixels, for comparing states. */
function strip(p: Piece): Omit<Piece, 'src'> {
  const { src: _src, ...rest } = p;
  return rest;
}

function clampScroll(v: number): number {
  return Number.isFinite(v) ? Math.max(-MAX_SCROLL, Math.min(MAX_SCROLL, v)) : 0;
}

/** Scale can't be exactly zero (the piece would vanish and couldn't be grabbed again). */
function nonZero(v: number): number {
  return Math.abs(v) < 0.01 ? (v < 0 ? -0.01 : 0.01) : v;
}

/** One layer's drawings at a moment (undo snapshots share the surfaces). */
interface CelSnapshot {
  surface: Surface;
  cels: Cel[] | null;
}

/** A change to a layer's frame-by-frame drawings. */
export class CelCommand implements Command {
  readonly bytes: number;

  constructor(
    readonly label: I18nKey,
    private readonly host: AnimHost,
    private readonly layer: RasterLayer,
    private readonly before: CelSnapshot,
    private readonly after: CelSnapshot,
  ) {
    // Drawings only one side holds (a new, cleared or deleted one) are what this step keeps alive.
    const set = (s: CelSnapshot) => new Set(s.cels ? celSurfaces(s.cels) : [s.surface]);
    const a = set(before);
    const b = set(after);
    let n = 128;
    for (const x of a) if (!b.has(x)) n += x.bytes;
    for (const x of b) if (!a.has(x)) n += x.bytes;
    this.bytes = n;
  }

  private apply(s: CelSnapshot): void {
    this.layer.cels = s.cels && s.cels.map((c) => ({ ...c }));
    this.layer.surface = s.surface;
    this.layer.showFrame(this.host.doc.timeline.frame);
    this.host.animationChanged(null);
  }

  undo(): void {
    this.apply(this.before);
  }

  redo(): void {
    this.apply(this.after);
  }
}
