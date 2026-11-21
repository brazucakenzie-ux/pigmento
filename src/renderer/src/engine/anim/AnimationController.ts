import type { Point, Rect } from '../core/geometry';
import type { PaintDocument, RasterLayer } from '../doc/Document';
import { Surface } from '../raster/Surface';
import { celShownIndex, celSurfaces, defaultLoopEnd, insertCel, loopedFrame, MAX_CELS, moveCelStart, removeCelAt, type Cel, type CelLoop, type CelLoopMode } from './cels';
import type { Command, History } from '../history/History';
import type { ImageBuf } from '../raster/transform';
import type { I18nKey, I18nParams } from '../../i18n';
import { movePivot, type Easing, type PieceState } from './interpolate';
import { movePivot3D } from './planeEdit';
import { MAX_STRENGTH, MIN_STRENGTH, type Camera, type Light } from './space';
import type { Hinge } from './frames';
import { attach, centrePivot, detach, duplicateTree, hinge, movePivotLocal, moveTree, removeTree, rootOf, subtree, type LinkRefusal } from './links';
import { BOX_FACES, faceSize, makeBox, MAX_BOX_SIDE, type BoxFace, type BoxSize } from './box';
import { MAX_TREE, type Scene } from './scene';
import { applyPreset, cleanTrail, cloneTrail, emissionAt, makeTrail, MAX_TRAIL_KEYS, MAX_TRAILS, type Trail, type TrailKey, type TrailPreset } from './trail';
import { bakeFollow, docMotion, docPaths, FollowedPaths, outlinesOf, sceneOf } from './follow';
import { fitSpin, MAX_SPIN_KEYS, moveSpinKey, placeWithSpin, removeSpinKey, setSpinKey, spinKeyFrame, spinSpeedAt, type SpinAxes } from './spin';
import type { PathMeasure } from './pathMeasure';
import { walkShapes } from '../vector/model';
import { cameraMoveAt, MAX_CAMERA_KEYS, moveCameraKey, removeCameraKey, setCameraKey, type CameraKey, type CameraMove } from './cameraMove';
import { MAX_PIXELS } from '../io/protocol';
import {
  clonePiece,
  makePiece,
  MAX_KEYFRAMES,
  MAX_PIECE_SIDE,
  MAX_PIECES,
  MAX_PROGRESS,
  MAX_SCROLL,
  moveKey,
  newPieceId,
  piecesBytes,
  removeKey,
  setKey,
  pieceStateAt,
  loopFrame,
  type PieceLoop,
  type KeyChange,
  type Piece,
  type PieceKind,
  type Follow,
  type Face,
  type Back,
  type Repeat,
} from './piece';
import { advance, clampFps, clampFrame, clampLength, MAX_FRAMES, type LoopMode, type PlayState, type Timeline } from './timeline';

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
  kind: PieceKind;
  /** The piece it follows (null: none). */
  parent: string | null;
  /** It hangs off its parent's edge. */
  hinged: boolean;
  /** How its moves repeat after its last keyframe. */
  loop: PieceLoop;
  /** Where its spin's speed is keyed (none: it doesn't spin). */
  spinKeys: { frame: number; easing: Easing }[];
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
  /** Frame-by-frame layers whose drawings loop (layers not listed don't). */
  celLoops: Record<string, CelLoop>;
  /** Painting tools paint on the selected piece instead of the active layer. */
  paintOnPiece: boolean;
  /** The camera 3D pieces are seen through. */
  camera: Camera;
  /** The light shaded pieces are lit by. */
  light: Light;
  /** The camera row is selected (its moves are what the options bar shows). */
  cameraSelected: boolean;
  /** Where the camera has keys for its moves. */
  cameraKeys: { frame: number; easing: Easing }[];
  /** The camera's move at the frame shown, while its row is selected. */
  cameraMove: CameraMoveFields | null;
  /** Shapes whose trim is keyed, each with a row under its layer. */
  shapes: ShapeKeysInfo[];
}

/** A shape whose trim is keyed: where it is, and its keys. */
export interface ShapeKeysInfo {
  layerId: string;
  id: string;
  /** Its place on its layer (1 = the bottom one). */
  n: number;
  keys: { frame: number; easing: Easing }[];
}

/** The camera's move at the frame shown, as the options bar shows it. */
export interface CameraMoveFields extends CameraMove {
  keyed: boolean;
  easing: Easing;
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
  /** In 3D: pixels behind the canvas, and degrees of tilt and turn. */
  depth: number;
  tilt: number;
  turn: number;
  /** What shows when it's turned round (not keyframed). */
  back: Back;
  /** Shading by the light, in percent (0 = off; not keyframed). */
  shade: number;
  /** Hinged pieces: degrees folded round the edge they hang from. */
  fold: number;
  /** It's a group (it carries linked pieces and is never drawn). */
  group: boolean;
  /** What it follows: nothing, another piece's pixels, or an edge it's hinged to. */
  link: 'none' | 'follows' | 'hinged';
  /** It's in a group's tree (or is the group): Centre pivot applies. */
  inGroup: boolean;
  /** Tilted or turned at this frame, or linked (the Animate tool's flat handles don't apply). */
  in3d: boolean;
  /** Easing from this frame's keyframe (or the one before it) to the next. */
  easing: Easing;
  /** There's a keyframe at this frame. */
  keyed: boolean;
  /** That keyframe bends the motion path. */
  curved: boolean;
  /** Which way copies of it tile on (not keyframed). */
  repeat: Repeat;
  /** The path it follows (null: none; only pieces that follow no other piece can). */
  follow: Follow | null;
  /** How far along that path, in percent (past 100 goes round a closed path again). */
  progress: number;
  /** It turns to face the way it goes (only pieces that follow no other piece can; not keyframed). */
  face: boolean;
  /** Which way its art points as drawn, in degrees (0 = right, 90 = down). */
  faceAngle: number;
  /** Its trails, each with how much it emits at the frame shown and whether that's keyed there. */
  trails: TrailFields[];
  /** How its moves repeat after its last keyframe. */
  loop: PieceLoop;
  /** Its spin at the frame shown (null: it doesn't spin). */
  spin: SpinFields | null;
}

/** A piece's spin at the frame shown, as the options show it. */
export interface SpinFields extends SpinAxes {
  /** Its speeds are keyed at the frame shown (on a looping piece's repeat, at the frame it repeats). */
  keyed: boolean;
  /** Easing from that key (or the one before it) to the next. */
  easing: Easing;
  /** Frames its speeds are keyed at. */
  keys: number[];
  /** The frame a speed set now is keyed at (the frame shown, or on a looping piece's repeat, the frame it repeats). */
  at: number;
}

/** A trail as the options show it. */
export interface TrailFields extends Trail {
  /** How much it emits at the frame shown (0 … 1). */
  emission: number;
  /** Its emission has a key at the frame shown. */
  keyed: boolean;
}

/** A path a piece can follow: one outline of a shape on a shape layer. */
export interface PathChoice extends Follow {
  layerName: string;
  /** The shape's place on its layer (1 = the bottom one). */
  shape: number;
  /** Which of its outlines, when it has more than one (1 = the first), else null. */
  part: number | null;
}

const DEG = 180 / Math.PI;

let nextTrailId = 1;

/** Everything about the animation an undo step can change (not the frame shown). */
export interface AnimSnapshot {
  pieces: Piece[];
  fps: number;
  length: number;
  loop: LoopMode;
  /** The camera 3D pieces are seen through. */
  camera: Camera;
  /** The light shaded pieces are lit by. */
  light: Light;
  /** The camera's moves. */
  cameraKeys: CameraKey[];
}

export function captureAnim(doc: PaintDocument): AnimSnapshot {
  const t = doc.timeline;
  return { pieces: doc.pieces.map(clonePiece), fps: t.fps, length: t.length, loop: t.loop, camera: { ...doc.camera }, light: { ...doc.light }, cameraKeys: doc.cameraKeys.map((k) => ({ ...k })) };
}

export function restoreAnim(doc: PaintDocument, s: AnimSnapshot): void {
  doc.pieces = s.pieces.map(clonePiece);
  doc.timeline.fps = s.fps;
  doc.timeline.length = s.length;
  doc.timeline.loop = s.loop;
  doc.timeline.frame = clampFrame(doc.timeline.frame, s.length);
  doc.camera = { ...s.camera };
  doc.light = { ...s.light };
  doc.cameraKeys = s.cameraKeys.map((k) => ({ ...k }));
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
  /** Default names for new pieces and groups, supplied by the UI (the engine never stores English text). */
  namer: (n: number, kind: PieceKind) => string = () => '';
  /** Names for a new box's faces, supplied by the UI. */
  faceNamer: (face: BoxFace) => string = () => '';
  private drag: AnimSnapshot | null = null;
  /** Paint on piece: painting tools paint the selected piece's own pixels (view state, not undoable). */
  private paintOn = false;
  /** The camera row is selected instead of a piece (view state). */
  private cameraOn = false;

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

  /** Every piece's pose at `frame` (the frame shown by default), as the picture's camera sees it. */
  scene(frame = this.frame): Scene {
    return sceneOf(this.doc, frame);
  }

  piece(id: string | null): Piece | null {
    return id ? (this.doc.pieces.find((p) => p.id === id) ?? null) : null;
  }

  get selected(): Piece | null {
    return this.piece(this.selectedId);
  }

  /** True once the picture has anything that moves. */
  get animated(): boolean {
    return this.doc.pieces.length > 0 || this.doc.hasCels || this.doc.hasTrimKeys;
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
    if (!this.doc.isEffectivelyVisible(layer.id) || !this.scene().shows(p)) {
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
      celLoops: Object.fromEntries(this.doc.rasterLayers().flatMap((l) => (l.cels && l.celLoop ? [[l.id, { ...l.celLoop }]] : []))),
      pieces: this.doc.pieces.map((p) => ({
        id: p.id,
        name: p.name,
        layerId: p.layerId,
        keys: p.keyframes.map((k) => ({ frame: k.frame, easing: k.easing })),
        kind: p.kind,
        parent: p.link?.parent ?? null,
        hinged: !!p.link?.hinge,
        loop: p.loop,
        spinKeys: p.spin?.keys.map((k) => ({ frame: k.frame, easing: k.easing })) ?? [],
      })),
      paintOnPiece: this.paintOn,
      camera: { ...this.doc.camera },
      light: { ...this.doc.light },
      cameraSelected: this.cameraOn,
      cameraKeys: this.doc.cameraKeys.map((k) => ({ frame: k.frame, easing: k.easing })),
      cameraMove: this.cameraOn ? this.cameraFields() : null,
      shapes: this.keyedShapes(),
    };
  }

  /** Shapes whose trim is keyed, layer by layer, bottom to top. */
  private keyedShapes(): ShapeKeysInfo[] {
    const out: ShapeKeysInfo[] = [];
    for (const layer of this.doc.vectorLayers()) {
      if (!layer.keyed) continue;
      let n = 0;
      for (const s of walkShapes(layer.objects)) {
        n++;
        if (s.trimKeys?.length) out.push({ layerId: layer.id, id: s.id, n, keys: s.trimKeys.map((k) => ({ frame: k.frame, easing: k.easing })) });
      }
    }
    return out;
  }

  /** The camera's move at the frame shown. */
  cameraFields(): CameraMoveFields {
    const f = this.frame;
    const keys = this.doc.cameraKeys;
    const at = keys.find((k) => k.frame === f);
    const before = [...keys].reverse().find((k) => k.frame <= f) ?? keys[0];
    return { ...cameraMoveAt(keys, f), keyed: at !== undefined, easing: (at ?? before)?.easing ?? 'linear' };
  }

  get cameraSelected(): boolean {
    return this.cameraOn;
  }

  /** Select the camera row (its moves show in the options bar), or let go of it. */
  selectCamera(on = true): void {
    if (on === this.cameraOn && (!on || this.selectedId === null)) return;
    this.cameraOn = on;
    if (on) this.selectedId = null;
    this.host.animationChanged(null);
  }

  /**
   * Set the camera's move at `frame` (adding a key there if there isn't one): one undo step. The
   * first move keyed after the start also keys the camera at rest on the first frame, so it moves
   * from there.
   */
  setCameraKey(frame: number, change: Partial<Omit<CameraKey, 'frame'>>): boolean {
    const adding = !this.doc.cameraKeys.some((k) => k.frame === frame);
    if (adding && this.doc.cameraKeys.length >= MAX_CAMERA_KEYS) {
      this.host.notify('error', 'notice.tooManyKeyframes', { max: MAX_CAMERA_KEYS });
      return false;
    }
    return this.change(adding ? 'history.cameraKeyAdd' : 'history.cameraKey', () => {
      let keys = this.doc.cameraKeys;
      if (!keys.length && frame > 0) keys = setCameraKey(keys, 0, {});
      this.doc.cameraKeys = setCameraKey(keys, frame, change);
      return true;
    });
  }

  removeCameraKey(frame: number): boolean {
    const next = removeCameraKey(this.doc.cameraKeys, frame);
    if (!next) return false;
    return this.change('history.cameraKeyDelete', () => {
      this.doc.cameraKeys = next;
      return true;
    });
  }

  moveCameraKey(from: number, to: number): boolean {
    const target = clampFrame(to, this.doc.timeline.length);
    const next = target !== from ? moveCameraKey(this.doc.cameraKeys, from, target) : null;
    if (!next) return false;
    return this.change('history.cameraKeyMove', () => {
      this.doc.cameraKeys = next;
      return true;
    });
  }

  /** The selected piece's values at the current frame. */
  fields(): PieceFields | null {
    const p = this.selected;
    if (!p) return null;
    const f = this.frame;
    // Where it is (on a path, where the path puts it); its angle as keyed (facing its way turns it on top of that).
    const s = { ...pieceStateAt(p, f), ...xyOf(this.scene().stateAt(p, f)) };
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
      depth: s.depth,
      tilt: s.tilt * DEG,
      turn: s.turn * DEG,
      fold: s.fold * DEG,
      group: p.kind === 'group',
      link: p.link ? (p.link.hinge ? 'hinged' : 'follows') : 'none',
      inGroup: rootOf(this.doc.pieces, p).kind === 'group',
      back: p.back,
      shade: p.shade * 100,
      in3d: s.tilt !== 0 || s.turn !== 0 || s.depth !== 0 || p.link !== null || spins3d(p),
      easing: (at ?? before).easing,
      keyed: at !== undefined,
      curved: at !== undefined && (at.in !== null || at.out !== null),
      repeat: p.repeat,
      follow: p.follow && !p.link ? { ...p.follow } : null,
      progress: s.progress * 100,
      face: p.face.on,
      faceAngle: p.face.angle * DEG,
      trails: p.trails.map((t) => ({ ...cloneTrail(t), emission: emissionAt(t, loopFrame(p.keyframes, p.loop, f)), keyed: t.keys.some((k) => k.frame === f) })),
      loop: p.loop,
      spin: this.spinFields(p, f),
    };
  }

  private spinFields(p: Piece, f: number): SpinFields | null {
    if (!p.spin) return null;
    const at = spinKeyFrame(p, f);
    const keys = p.spin.keys;
    const key = keys.find((k) => k.frame === at);
    const before = [...keys].reverse().find((k) => k.frame <= at) ?? keys[0];
    return { ...spinSpeedAt(p.spin, at), keyed: key !== undefined, easing: (key ?? before).easing, keys: keys.map((k) => k.frame), at };
  }

  /** Set the selected piece's values at the current frame (auto-key), in the options bar's units. */
  setFields(change: Partial<Omit<PieceFields, 'keyed' | 'curved' | 'repeat' | 'back' | 'in3d' | 'shade' | 'group' | 'link' | 'inGroup' | 'follow' | 'face' | 'faceAngle' | 'trails' | 'loop' | 'spin'>>): boolean {
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
    if (change.tilt !== undefined) k.tilt = change.tilt / DEG;
    if (change.turn !== undefined) k.turn = change.turn / DEG;
    if (change.fold !== undefined) k.fold = change.fold / DEG;
    if (change.progress !== undefined) k.progress = clampProgress(change.progress / 100);
    // Never at or past the camera.
    if (change.depth !== undefined) k.depth = Math.max(-this.doc.space.f * 0.99, Math.min(1e6, change.depth));
    if (change.easing !== undefined) k.easing = change.easing;
    return this.setKey(p.id, this.frame, k);
  }

  /**
   * Give a piece a trail, made as a preset, coming from its middle (a group's pivot): one undo
   * step. Its id, or null (and says why) when the piece has as many as it can.
   */
  addTrail(id: string, preset: TrailPreset = 'rocketSmoke'): string | null {
    const p = this.piece(id);
    if (!p) return null;
    if (p.trails.length >= MAX_TRAILS) {
      this.host.notify('info', 'notice.tooManyTrails', { max: MAX_TRAILS });
      return null;
    }
    const tid = `trail-${Date.now().toString(36)}-${nextTrailId++}`;
    const emitter = p.kind === 'group' ? { ...p.pivot } : { x: p.src.width / 2, y: p.src.height / 2 };
    const t = applyPreset(makeTrail(tid, 'puffs', emitter, Math.floor(Math.random() * 2 ** 31)), preset);
    const done = this.change('history.trailAdd', () => {
      p.trails = [...p.trails, t];
      return true;
    });
    return done ? tid : null;
  }

  /** Take a trail off a piece (one undo step). */
  removeTrail(id: string, trailId: string): boolean {
    const p = this.piece(id);
    if (!p?.trails.some((t) => t.id === trailId)) return false;
    return this.change('history.trailRemove', () => {
      p.trails = p.trails.filter((t) => t.id !== trailId);
      return true;
    });
  }

  /** Move a trail up or down the piece's list (later ones draw over earlier ones; one undo step). */
  moveTrail(id: string, trailId: string, dir: -1 | 1): boolean {
    const p = this.piece(id);
    const i = p ? p.trails.findIndex((t) => t.id === trailId) : -1;
    if (!p || i < 0 || i + dir < 0 || i + dir >= p.trails.length) return false;
    return this.change('history.trailMove', () => {
      const list = [...p.trails];
      [list[i], list[i + dir]] = [list[i + dir], list[i]];
      p.trails = list;
      return true;
    });
  }

  /** Change a trail's settings, kept in range (one undo step). */
  setTrail(id: string, trailId: string, change: Partial<Omit<Trail, 'id' | 'keys'>>, label: I18nKey = 'history.trail'): boolean {
    const p = this.piece(id);
    if (!p?.trails.some((t) => t.id === trailId)) return false;
    return this.change(label, () => {
      p.trails = p.trails.map((t) => (t.id === trailId ? cleanTrail({ ...t, ...change }) : t));
      return true;
    });
  }

  /** Make a trail over as a preset, keeping where it comes from and its keyed emission (one undo step). */
  presetTrail(id: string, trailId: string, preset: TrailPreset): boolean {
    const p = this.piece(id);
    if (!p?.trails.some((t) => t.id === trailId)) return false;
    return this.change('history.trailPreset', () => {
      p.trails = p.trails.map((t) => (t.id === trailId ? applyPreset(t, preset) : t));
      return true;
    });
  }

  /** Key how much a trail emits at `frame` (0 … 1; one undo step). */
  keyEmission(id: string, trailId: string, frame: number, amount: number, easing?: Easing): boolean {
    const p = this.piece(id);
    const t = p?.trails.find((q) => q.id === trailId);
    if (!p || !t) return false;
    if (!t.keys.some((k) => k.frame === frame) && t.keys.length >= MAX_TRAIL_KEYS) {
      this.host.notify('error', 'notice.tooManyKeyframes', { max: MAX_TRAIL_KEYS });
      return false;
    }
    const before = [...t.keys].reverse().find((k) => k.frame < frame);
    const at = t.keys.find((k) => k.frame === frame);
    const key: TrailKey = { frame, amount, easing: easing ?? at?.easing ?? before?.easing ?? 'linear' };
    return this.change('history.trailKey', () => {
      p.trails = p.trails.map((q) => (q.id === trailId ? cleanTrail({ ...q, keys: [...q.keys.filter((k) => k.frame !== frame), key] }) : q));
      return true;
    });
  }

  /** Remove a trail's emission key at `frame` (one undo step). */
  removeEmissionKey(id: string, trailId: string, frame: number): boolean {
    const p = this.piece(id);
    const t = p?.trails.find((q) => q.id === trailId);
    if (!p || !t?.keys.some((k) => k.frame === frame)) return false;
    return this.change('history.trailKeyDelete', () => {
      p.trails = p.trails.map((q) => (q.id === trailId ? { ...q, keys: q.keys.filter((k) => k.frame !== frame) } : q));
      return true;
    });
  }

  /**
   * Face the way it goes, or not, and which way its art points as drawn (radians): one undo step,
   * not keyframed. Says why not for a piece that follows another piece.
   */
  setFace(id: string, change: Partial<Face>): boolean {
    const p = this.piece(id);
    if (!p) return false;
    const next = { on: change.on ?? p.face.on, angle: change.angle ?? p.face.angle };
    next.angle = Number.isFinite(next.angle) ? Math.atan2(Math.sin(next.angle), Math.cos(next.angle)) : 0;
    if (next.on === p.face.on && next.angle === p.face.angle) return false;
    if (next.on && p.link) {
      this.host.notify('info', 'notice.faceLinked');
      return false;
    }
    return this.change('history.face', () => {
      p.face = next;
      return true;
    });
  }

  /** How a piece's moves repeat after its last keyframe: not at all, round again, or back and forth (one undo step). */
  setPieceLoop(id: string, loop: PieceLoop): boolean {
    const p = this.piece(id);
    if (!p || p.loop === loop) return false;
    return this.change('history.pieceLoop', () => {
      p.loop = loop;
      return true;
    });
  }

  /**
   * Set a piece's spin speeds (turns a second) or easing at `frame` (one undo step): that speed key
   * changed, or one added (on a looping piece's repeat, at the frame it repeats, where its speed is
   * read). A piece that doesn't spin starts to. Never keys its position. A hinged piece turns with
   * its group instead.
   */
  setSpin(id: string, frame: number, change: Partial<SpinAxes & { easing: Easing }>): boolean {
    const p = this.piece(id);
    if (!p) return false;
    if (p.link?.hinge) {
      this.host.notify('info', 'notice.spinHinged');
      return false;
    }
    const at = spinKeyFrame(p, frame);
    if (p.spin && !p.spin.keys.some((k) => k.frame === at) && p.spin.keys.length >= MAX_SPIN_KEYS) {
      this.host.notify('error', 'notice.tooManyKeyframes', { max: MAX_SPIN_KEYS });
      return false;
    }
    return this.change(p.spin ? 'history.spin' : 'history.spinStart', () => {
      p.spin = setSpinKey(p.spin, at, change);
      return true;
    });
  }

  /** Remove a piece's speed key at `frame` (one undo step); without keys left it stops spinning. */
  removeSpinKey(id: string, frame: number): boolean {
    const p = this.piece(id);
    const next = p && removeSpinKey(p.spin, frame);
    if (!p || next === undefined) return false;
    return this.change('history.spinKeyDelete', () => {
      p.spin = next;
      return true;
    });
  }

  /** Move a piece's speed key to another frame (one undo step; refused onto another key). */
  moveSpinKey(id: string, from: number, to: number): boolean {
    const p = this.piece(id);
    const target = Math.min(MAX_FRAMES - 1, Math.max(0, Math.round(to)));
    const next = p && target !== from ? moveSpinKey(p.spin, from, target) : null;
    if (!p || !next) return false;
    return this.change('history.spinKeyMove', () => {
      p.spin = next;
      return true;
    });
  }

  /** Fit to the timeline: its speeds made a touch faster or slower so it turns a whole number of times over the timeline (one undo step). */
  fitSpin(id: string): boolean {
    const p = this.piece(id);
    const next = p && fitSpin(p, this.doc.timeline.length, this.doc.timeline.fps);
    if (!p || !next) return false;
    return this.change('history.spinFit', () => {
      p.spin = next;
      return true;
    });
  }

  /** Stop spinning: the piece goes back to how its keyframes have it (one undo step). */
  stopSpin(id: string): boolean {
    const p = this.piece(id);
    if (!p?.spin) return false;
    return this.change('history.spinStop', () => {
      p.spin = null;
      return true;
    });
  }

  /** What shows when a piece is turned round in 3D (one undo step; not keyframed). */
  setBack(id: string, back: Back): boolean {
    const p = this.piece(id);
    if (!p || p.back === back) return false;
    return this.change('history.pieceBack', () => {
      p.back = back;
      return true;
    });
  }

  /** The camera with `change`, kept sensible (strength 1–100 %, a finite vanishing point). */
  private cameraWith(change: Partial<Camera>): Camera {
    const c = { ...this.doc.camera, ...change };
    const fin = (v: number, d: number) => (Number.isFinite(v) ? Math.max(-1e6, Math.min(1e6, v)) : d);
    return { x: fin(c.x, this.doc.width / 2), y: fin(c.y, this.doc.height / 2), strength: Math.min(MAX_STRENGTH, Math.max(MIN_STRENGTH, Number.isFinite(c.strength) ? c.strength : 50)) };
  }

  /** Move the vanishing point or change the perspective's strength (one undo step). */
  setCamera(change: Partial<Camera>): boolean {
    const next = this.cameraWith(change);
    return this.change('history.camera', () => {
      this.doc.camera = next;
      return true;
    });
  }

  /** Change the camera live during a drag (no undo step yet). */
  previewCamera(change: Partial<Camera>): void {
    if (!this.drag) return;
    this.doc.camera = this.cameraWith(change);
    this.host.animationChanged(null);
  }

  /** Where the light comes from (degrees round the view from above, and its height: 0 … 90). One undo step. */
  setLight(change: Partial<Light>): boolean {
    const l = { ...this.doc.light, ...change };
    const next = { angle: Number.isFinite(l.angle) ? ((((l.angle + 180) % 360) + 360) % 360) - 180 : -30, height: Math.min(90, Math.max(0, Number.isFinite(l.height) ? l.height : 45)) };
    return this.change('history.light', () => {
      this.doc.light = next;
      return true;
    });
  }

  /** How strongly a piece is shaded by the light in 3D (0 … 1, 0 = off; one undo step, not keyframed). */
  setShade(id: string, shade: number): boolean {
    const p = this.piece(id);
    const v = Math.min(1, Math.max(0, Number.isFinite(shade) ? shade : 0));
    if (!p || p.shade === v) return false;
    return this.change('history.pieceShade', () => {
      p.shade = v;
      return true;
    });
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
    this.cameraOn = false;
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
    const before: CelSnapshot = { surface: layer.surface, cels: layer.cels && layer.cels.map((c) => ({ ...c })), loop: layer.celLoop && { ...layer.celLoop } };
    if (!fn()) return false;
    // Down to one drawing: the layer is a still layer again (with nothing to loop).
    if (layer.cels && layer.cels.length === 1) {
      layer.surface = layer.cels[0].surface;
      layer.cels = null;
    }
    if (!layer.cels) layer.celLoop = null;
    // A loop always ends after its last drawing starts.
    else if (layer.celLoop && layer.celLoop.end <= layer.cels[layer.cels.length - 1].start) layer.celLoop = { ...layer.celLoop, end: layer.cels[layer.cels.length - 1].start + 1 };
    layer.showFrame(this.frame);
    const after: CelSnapshot = { surface: layer.surface, cels: layer.cels && layer.cels.map((c) => ({ ...c })), loop: layer.celLoop && { ...layer.celLoop } };
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
    // A repeat of the loop shows drawings from its first cycle: new ones go there.
    if (layer.celLoop && frame >= layer.celLoop.end) {
      this.host.notify('info', 'notice.drawingInRepeat', { end: layer.celLoop.end });
      return false;
    }
    const surface = copy ? cels[celShownIndex(cels, layer.celLoop, frame)].surface.clone() : new Surface(this.doc.width, this.doc.height);
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
    const next = layer?.cels ? removeCelAt(layer.cels, loopedFrame(layer.cels, layer.celLoop, this.frame)) : null;
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
      const i = celShownIndex(layer.cels, layer.celLoop, this.frame);
      layer.cels = layer.cels.map((c, k) => (k === i ? { start: c.start, surface: blank } : { ...c }));
      return true;
    });
  }

  /** Move where drawing `index` starts: the drawing before it is held longer or shorter. */
  moveDrawing(layerId: string, index: number, start: number): boolean {
    const layer = this.rasterLayer(layerId);
    const next = layer?.cels ? moveCelStart(layer.cels, index, clampFrame(start, this.doc.timeline.length)) : null;
    if (!layer || !next) return false;
    // The last drawing still starts before the loop ends.
    if (layer.celLoop && next[next.length - 1].start >= layer.celLoop.end) return false;
    return this.celChange('history.holdDrawing', layer, () => {
      layer.cels = next;
      return true;
    });
  }

  /**
   * Loop a frame-by-frame layer's drawings for the whole timeline (cycle or back and forth), or
   * stop (null): one undo step. The cycle keeps its end, or starts with the last drawing as long
   * as the one before it. Says why not for a layer with one drawing.
   */
  setDrawingLoop(layerId: string, mode: CelLoopMode | null): boolean {
    const layer = this.rasterLayer(layerId);
    if (!layer) return false;
    if (mode && !layer.cels) {
      this.host.notify('info', 'notice.loopNeedsDrawings');
      return false;
    }
    if ((layer.celLoop?.mode ?? null) === mode) return false;
    return this.celChange('history.loopDrawings', layer, () => {
      layer.celLoop = mode && layer.cels ? { mode, end: layer.celLoop?.end ?? defaultLoopEnd(layer.cels) } : null;
      return true;
    });
  }

  /** Where a looping layer's cycle ends (the frame after its last drawing's last): one undo step. */
  setLoopEnd(layerId: string, end: number): boolean {
    const layer = this.rasterLayer(layerId);
    const loop = layer?.celLoop;
    if (!layer?.cels || !loop) return false;
    const e = Math.min(MAX_FRAMES, Math.max(layer.cels[layer.cels.length - 1].start + 1, Math.round(end)));
    if (e === loop.end) return false;
    return this.celChange('history.loopEnd', layer, () => {
      layer.celLoop = { ...loop, end: e };
      return true;
    });
  }

  /** Frames that have a keyframe: of one piece, or of every piece (sorted, no repeats). */
  keyFrames(id: string | null): number[] {
    const pieces = id ? [this.piece(id)].filter((p): p is Piece => p !== null) : this.doc.pieces;
    return [...new Set(pieces.flatMap((p) => p.keyframes.map((k) => k.frame)))].sort((a, b) => a - b);
  }

  /** Go to the previous (-1) or next (1) keyframe of the selected piece (or the camera), or of any piece. */
  stepKey(dir: -1 | 1): void {
    const frames = this.cameraOn ? this.doc.cameraKeys.map((k) => k.frame) : this.keyFrames(this.selected ? this.selectedId : null);
    const f = this.frame;
    const target = dir > 0 ? frames.find((k) => k > f) : [...frames].reverse().find((k) => k < f);
    if (target !== undefined) this.setFrame(target);
  }

  select(id: string | null): void {
    const next = this.piece(id) ? id : null;
    if (next === this.selectedId && !(next && this.cameraOn)) return;
    this.selectedId = next;
    if (next) this.cameraOn = false;
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
    const n = this.doc.pieces.filter((p) => p.kind === 'piece').length + 1;
    const piece = makePiece(newPieceId(), this.namer(n, 'piece'), layerId, src, home, this.frame);
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

  /**
   * Add a tree of linked pieces made elsewhere (a box), on top of their layer's pieces, as one
   * undo step; its first piece of pixels is selected. False (and says why) if they don't fit.
   */
  addTree(pieces: readonly Piece[], label: I18nKey): boolean {
    if (this.doc.pieces.length + pieces.length > MAX_PIECES) {
      this.host.notify('error', 'notice.tooManyPieces', { max: MAX_PIECES });
      return false;
    }
    const done = this.change(label, () => {
      this.doc.pieces.push(...pieces.map(clonePiece));
      return true;
    });
    const first = pieces.find((p) => p.kind === 'piece');
    if (done && first) this.select(first.id);
    return done;
  }

  /**
   * Box maker: six blank faces of `size` (pixels), hinged and folded into a box in the middle of
   * the picture on the active layer, turned a little so its sides show, ready to paint. One undo
   * step; its front is selected. False (saying why) when it can't be made there.
   */
  makeBox(size: BoxSize): boolean {
    const active = this.doc.layerById(this.doc.activeId);
    if (active?.kind !== 'raster') {
      this.host.notify('info', 'notice.animatePixelsOnly');
      return false;
    }
    const layer = this.rasterLayer(active.id);
    if (!layer) return false;
    const side = (v: number) => Math.max(1, Math.min(MAX_BOX_SIDE, Math.round(Number.isFinite(v) ? v : 1)));
    const s = { w: side(size.w), h: side(size.h), d: side(size.d) };
    for (const f of BOX_FACES) {
      const fs = faceSize(f, s);
      if (!this.fits(fs.w, fs.h)) return false;
    }
    const groups = this.doc.pieces.filter((p) => p.kind === 'group').length;
    const pieces = makeBox(newPieceId, layer.id, { x: this.doc.width / 2, y: this.doc.height / 2 }, s, this.frame, { names: this.faceNamer, group: this.namer(groups + 1, 'group') });
    // Tilted and turned a little, so the top and the right side show beside the front.
    pieces[0].keyframes = setKey(pieces[0].keyframes, this.frame, { tilt: (-20 * Math.PI) / 180, turn: (-30 * Math.PI) / 180 });
    return this.addTree(pieces, 'history.box');
  }

  /** Move the pivot of the group a piece is in to the middle of its pieces, so it turns about it (one undo step). */
  centrePivot(id: string): boolean {
    const p = this.piece(id);
    if (!p) return false;
    const top = rootOf(this.doc.pieces, p);
    if (top.kind !== 'group') return false;
    return this.change('history.centrePivot', () => {
      this.doc.pieces = centrePivot(this.doc.pieces, top.id, this.frame, this.doc.space, docMotion(this.doc));
      return true;
    });
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

  /** Delete a piece with the pieces linked under it (and its group, if that's left empty). */
  remove(id: string): boolean {
    if (!this.piece(id)) return false;
    const done = this.change('history.pieceDelete', () => {
      this.doc.pieces = removeTree(this.doc.pieces, id);
      return true;
    });
    if (!this.piece(this.selectedId)) this.selectedId = null;
    return done;
  }

  /** Say why a link can't be made. */
  private refused(why: LinkRefusal): false {
    if (why === 'layer') this.host.notify('info', 'notice.linkLayer');
    else if (why === 'loop') this.host.notify('info', 'notice.linkLoop');
    else if (why === 'full') this.host.notify('info', 'notice.linkFull', { max: MAX_TREE });
    else if (why === 'group') this.host.notify('info', 'notice.linkGroup');
    else if (why === 'path') this.host.notify('info', 'notice.linkPath');
    else if (why === 'face') this.host.notify('info', 'notice.linkFace');
    return false;
  }

  /** `id` follows `parentId` from now on, staying where it is at this frame (one undo step). */
  attach(id: string, parentId: string): boolean {
    const next = attach(this.doc.pieces, id, parentId, this.frame, this.doc.space, docMotion(this.doc));
    if (typeof next === 'string') return this.refused(next);
    return this.change('history.pieceAttach', () => {
      this.doc.pieces = next;
      return true;
    });
  }

  /** Hang `id` off an edge of `parentId`, folded by `fold` radians (one undo step; a group may be made to carry them). */
  hinge(id: string, parentId: string, h: Hinge, fold: number): boolean {
    const groups = this.doc.pieces.filter((p) => p.kind === 'group').length;
    const next = hinge(this.doc.pieces, id, parentId, h, fold, newPieceId);
    if (typeof next === 'string') return this.refused(next);
    if (next.group) next.group.name = this.namer(groups + 1, 'group');
    return this.change('history.hinge', () => {
      this.doc.pieces = next.pieces;
      return true;
    });
  }

  /** `id` follows nothing any more, moving as it did (one undo step). */
  detach(id: string): boolean {
    const p = this.piece(id);
    if (!p?.link) return false;
    return this.change(p.link.hinge ? 'history.unhinge' : 'history.pieceDetach', () => {
      this.doc.pieces = detach(this.doc.pieces, id, this.doc.space, docMotion(this.doc));
      return true;
    });
  }

  /** A copy of a piece and the pieces under it, linked as they are, then selected (one undo step). */
  duplicate(id: string): string | null {
    if (!this.piece(id)) return null;
    if (this.doc.pieces.length + subtree(this.doc.pieces, id).length > MAX_PIECES) {
      this.host.notify('error', 'notice.tooManyPieces', { max: MAX_PIECES });
      return null;
    }
    const next = duplicateTree(this.doc.pieces, id, newPieceId);
    if (!next) {
      this.host.notify('info', 'notice.linkFull', { max: MAX_TREE });
      return null;
    }
    const done = this.change('history.pieceDuplicate', () => {
      this.doc.pieces = next.pieces;
      return true;
    });
    if (!done) return null;
    this.select(next.copy.id);
    return next.copy.id;
  }

  /** Move the whole tree a piece is in onto another pixel layer (one undo step). */
  moveToLayer(id: string, layerId: string): boolean {
    const p = this.piece(id);
    const layer = this.doc.layerById(layerId);
    if (!p || layer?.kind !== 'raster' || p.layerId === layerId) return false;
    if (layer.locked) {
      this.host.notify('info', 'notice.layerLocked');
      return false;
    }
    return this.change('history.pieceMoveLayer', () => {
      this.doc.pieces = moveTree(this.doc.pieces, id, layerId);
      return true;
    });
  }

  /** The paths pieces follow, as of the picture's last change (see bakeLostPaths). */
  private followed = new FollowedPaths();

  /**
   * Follow a path (one undo step). A piece that has no progress yet is spread evenly along it:
   * from the start at its first keyframe to the end at its last, or at the timeline's last frame
   * if it has only one keyframe. Following nothing (null) keeps the motion it had, as keyframes.
   * Says why not when it can't (it follows another piece, or the path is gone).
   */
  follow(id: string, target: Follow | null): boolean {
    const p = this.piece(id);
    if (!p) return false;
    const paths = docPaths(this.doc);
    if (!target) {
      if (!p.follow) return false;
      const path = paths(p.follow);
      return this.change('history.followPath', () => {
        if (path && !p.link) p.keyframes = bakeFollow(p, path);
        p.follow = null;
        return true;
      });
    }
    if (p.link) {
      this.host.notify('info', 'notice.followLinked');
      return false;
    }
    if (!paths(target)) {
      this.host.notify('info', 'notice.followNoPath');
      return false;
    }
    return this.change('history.followPath', () => {
      if (p.keyframes.every((k) => k.progress === 0)) {
        let keys = p.keyframes;
        const last = this.doc.timeline.length - 1;
        if (keys.length === 1 && keys[0].frame < last) keys = setKey(keys, last, {});
        const f0 = keys[0].frame;
        const span = keys[keys.length - 1].frame - f0;
        p.keyframes = keys.map((k) => ({ ...k, progress: span > 0 ? (k.frame - f0) / span : 0 }));
      }
      p.follow = { ...target };
      return true;
    });
  }

  /**
   * `id` follows `target` from now on with each keyframe `progress[i]` of the way along: for a path
   * made from its own motion path (see motionToPath), whose bends the path now holds. One undo step.
   */
  followWith(id: string, target: Follow, progress: readonly number[]): boolean {
    const p = this.piece(id);
    if (!p || p.link || progress.length !== p.keyframes.length) return false;
    return this.change('history.motionToShape', () => {
      p.keyframes = p.keyframes.map((k, i) => ({ ...k, progress: clampProgress(progress[i]), in: null, out: null }));
      p.follow = { ...target };
      return true;
    });
  }

  /** The path `p` follows, measured (null: it follows none, follows another piece instead, or the path is gone). */
  pathOf(p: Piece): PathMeasure | null {
    return p.follow && !p.link ? docPaths(this.doc)(p.follow) : null;
  }

  /** Every path a piece could follow: each outline of each shape on the shape layers, bottom to top. */
  pathChoices(): PathChoice[] {
    const out: PathChoice[] = [];
    for (const layer of this.doc.vectorLayers()) {
      let n = 0;
      for (const s of walkShapes(layer.objects)) {
        n++;
        const subs = outlinesOf(s).flatMap((m, sub) => (m && m.length > 0 ? [sub] : []));
        for (const sub of subs) out.push({ layerId: layer.id, objectId: s.id, sub, layerName: layer.name, shape: n, part: subs.length > 1 ? sub + 1 : null });
      }
    }
    return out;
  }

  /** Note the paths pieces follow now (after every change, undo and redo, and opening a picture). */
  rememberPaths(): void {
    this.followed.remember(this.doc);
  }

  /**
   * Called as each change is recorded: pieces whose path that change deleted keep the motion they
   * had, as keyframes, in the same undo step. Null when nothing needs it.
   */
  bakeLostPaths(): Command | null {
    const lost = this.followed.lost(this.doc);
    if (!lost.length || this.drag) return null;
    const before = captureAnim(this.doc);
    for (const { piece, path } of lost) {
      if (path && !piece.link) piece.keyframes = bakeFollow(piece, path);
      piece.follow = null;
    }
    return new AnimationCommand('history.followPath', this.host, before, captureAnim(this.doc));
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
      p.keyframes = setKey(p.keyframes, frame, change, p.loop);
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
      // In 3D the piece stays put too (a flat piece's keyframes come out as movePivot's). A piece
      // following another is placed in that piece's pixels; a hinged one by its hinge alone.
      // A spinning one stays put as it shows, turned by its spin.
      const scene = this.scene();
      const move = (keys: typeof p.keyframes) => {
        const in3d = keys.some((k) => k.depth !== 0 || k.tilt !== 0 || k.turn !== 0);
        if (p.link) return movePivotLocal(keys, p.pivot, pivot);
        return in3d ? movePivot3D(keys, p.pivot, pivot, this.doc.space) : movePivot(keys, p.pivot, pivot);
      };
      if (!p.link?.hinge) p.keyframes = placeWithSpin(p.keyframes, (f) => scene.spinOf(p, f), move);
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
  if (a.camera.x !== b.camera.x || a.camera.y !== b.camera.y || a.camera.strength !== b.camera.strength) return false;
  if (a.light.angle !== b.light.angle || a.light.height !== b.light.height) return false;
  if (JSON.stringify(a.cameraKeys) !== JSON.stringify(b.cameraKeys)) return false;
  if (a.pieces.some((p, i) => p.src !== b.pieces[i].src)) return false;
  return JSON.stringify(a.pieces.map(strip)) === JSON.stringify(b.pieces.map(strip));
}

/** It spins in 3D (tilting or turning forever). */
function spins3d(p: Piece): boolean {
  return !!p.spin?.keys.some((k) => k.tilt !== 0 || k.turn !== 0);
}

/** A piece without its pixels, for comparing states. */
function strip(p: Piece): Omit<Piece, 'src'> {
  const { src: _src, ...rest } = p;
  return rest;
}

function clampScroll(v: number): number {
  return Number.isFinite(v) ? Math.max(-MAX_SCROLL, Math.min(MAX_SCROLL, v)) : 0;
}

/** Just where a state puts the piece. */
function xyOf(s: PieceState): { x: number; y: number } {
  return { x: s.x, y: s.y };
}

function clampProgress(v: number): number {
  return Number.isFinite(v) ? Math.max(-MAX_PROGRESS, Math.min(MAX_PROGRESS, v)) : 0;
}

/** Scale can't be exactly zero (the piece would vanish and couldn't be grabbed again). */
function nonZero(v: number): number {
  return Math.abs(v) < 0.01 ? (v < 0 ? -0.01 : 0.01) : v;
}

/** One layer's drawings at a moment (undo snapshots share the surfaces). */
interface CelSnapshot {
  surface: Surface;
  cels: Cel[] | null;
  loop: CelLoop | null;
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
    this.layer.celLoop = s.loop && { ...s.loop };
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
