import type { Point, Rect } from '../core/geometry';
import type { PaintDocument } from '../doc/Document';
import type { Command, History } from '../history/History';
import type { ImageBuf } from '../raster/transform';
import type { I18nKey, I18nParams } from '../../i18n';
import { movePivot, type Easing } from './interpolate';
import {
  clonePiece,
  makePiece,
  MAX_KEYFRAMES,
  MAX_PIECES,
  moveKey,
  piecesBytes,
  removeKey,
  setKey,
  pieceStateAt,
  type KeyChange,
  type Piece,
} from './piece';
import { clampFps, clampFrame, clampLength, type LoopMode, type Timeline } from './timeline';

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
  /** Easing from this frame's keyframe (or the one before it) to the next. */
  easing: Easing;
  /** There's a keyframe at this frame. */
  keyed: boolean;
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
    for (const img of a) if (!b.has(img)) src += img.data.byteLength;
    for (const img of b) if (!a.has(img)) src += img.data.byteLength;
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

let nextPieceId = 1;

/**
 * Pieces, keyframes and the timeline. Every change is one undo step; a drag (begin → preview …
 * → end) is one step too, however many times it previews.
 */
export class AnimationController {
  selectedId: string | null = null;
  /** Default names for new pieces, supplied by the UI (the engine never stores English text). */
  namer: (n: number) => string = () => '';
  private drag: AnimSnapshot | null = null;

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
    return this.doc.pieces.length > 0;
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
      pieces: this.doc.pieces.map((p) => ({ id: p.id, name: p.name, layerId: p.layerId, keys: p.keyframes.map((k) => ({ frame: k.frame, easing: k.easing })) })),
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
      easing: (at ?? before).easing,
      keyed: at !== undefined,
    };
  }

  /** Set the selected piece's values at the current frame (auto-key), in the options bar's units. */
  setFields(change: Partial<Omit<PieceFields, 'keyed'>>): boolean {
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
    if (change.easing !== undefined) k.easing = change.easing;
    return this.setKey(p.id, this.frame, k);
  }

  /** A new document was loaded (or the old one replaced). */
  reset(): void {
    this.selectedId = null;
    this.drag = null;
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
    return this.change('history.timeline', () => {
      t.fps = fps;
      t.length = length;
      t.loop = loop;
      t.frame = clampFrame(t.frame, length);
      return true;
    });
  }

  /** Add a piece made from `src`, lifted from `home` on layer `layerId`, with a keyframe at the current frame. */
/** False (and says so) when the picture already has the most pieces it can. */
  canAdd(): boolean {
    if (this.doc.pieces.length < MAX_PIECES) return true;
    this.host.notify('error', 'notice.tooManyPieces', { max: MAX_PIECES });
    return false;
  }

  add(src: ImageBuf, home: Rect, layerId: string): Piece | null {
    if (!this.canAdd()) return null;
    const n = this.doc.pieces.length + 1;
    const piece = makePiece(`piece-${nextPieceId++}-${Date.now().toString(36)}`, this.namer(n), layerId, src, home, this.frame);
    this.change('history.animateSelection', () => {
      this.doc.pieces.push(piece);
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

/** Scale can't be exactly zero (the piece would vanish and couldn't be grabbed again). */
function nonZero(v: number): number {
  return Math.abs(v) < 0.01 ? (v < 0 ? -0.01 : 0.01) : v;
}
