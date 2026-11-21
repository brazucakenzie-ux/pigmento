import type { PaintDocument } from '../doc/Document';
import { shapeOutline } from '../vector/convert';
import { walkShapes, type VectorShape } from '../vector/model';
import type { PathAnchor, SubPath } from '../vector/pathData';
import { FULL_TRIM, trimAt, type Trim } from '../vector/trim';
import { measurePath, type PathMeasure } from './pathMeasure';
import { MAX_KEYFRAMES, pieceStateAt, type Follow, type Piece } from './piece';
import type { Keyframe } from './interpolate';
import { Scene, type Motion } from './scene';
import type { EmitterPath } from './trail';
import type { Point } from '../core/geometry';

/** Finds the path a piece follows, measured (null when it's gone). */
export type PathResolver = (f: Follow) => PathMeasure | null;

/** Shapes are immutable, so each one's outlines are measured once. */
const measured = new WeakMap<VectorShape, (PathMeasure | null)[]>();

/** The shape `f` names, if it's still there. */
export function followedShape(doc: PaintDocument, f: Follow): VectorShape | null {
  const layer = doc.layerById(f.layerId);
  if (layer?.kind !== 'vector') return null;
  for (const s of walkShapes(layer.objects)) if (s.id === f.objectId) return s;
  return null;
}

/** A shape's outlines, measured (null for one too short to follow). */
export function outlinesOf(s: VectorShape): readonly (PathMeasure | null)[] {
  let list = measured.get(s);
  if (!list) {
    list = (shapeOutline(s)?.subpaths ?? []).map(measurePath);
    measured.set(s, list);
  }
  return list;
}

/**
 * A shape's trim at `frame` (see trimAt), with an end tied to a piece that follows it (see
 * TrimTie) put where that piece is along it, less the gap. A tie to a piece that doesn't follow
 * this shape (any more) is left out.
 */
export function tiedTrimAt(doc: PaintDocument, layerId: string, s: VectorShape, frame: number): Trim | undefined {
  const base = trimAt(s, frame);
  const tie = s.trimTie;
  if (!tie) return base;
  const p = doc.pieces.find((q) => q.id === tie.piece);
  const f = p?.follow;
  if (!p || !f || p.link || f.layerId !== layerId || f.objectId !== s.id) return base;
  const outlines = outlinesOf(s);
  const m = outlines[f.sub];
  if (!m) return base;
  let before = 0;
  let total = 0;
  outlines.forEach((o, i) => {
    const len = o?.length ?? 0;
    if (i < f.sub) before += len;
    total += len;
  });
  if (total <= 0) return base;
  // Where the piece is along all the shape's outlines, as one long line.
  const progress = pieceStateAt(p, frame).progress;
  const local = m.closed ? progress - Math.floor(progress) : Math.min(1, Math.max(0, progress));
  const at = Math.min(1, Math.max(0, (before + local * m.length - tie.gap) / total));
  const t = { ...FULL_TRIM, ...base };
  return tie.end === 'start' ? { ...t, start: at } : { ...t, end: at };
}

/** The paths in a picture, as pieces follow them. */
export function docPaths(doc: PaintDocument): PathResolver {
  return (f) => {
    const s = followedShape(doc, f);
    return s ? (outlinesOf(s)[f.sub] ?? null) : null;
  };
}

/** What places a picture's pieces besides their keyframes: the paths they follow, and its frame rate (for facing). */
export function docMotion(doc: PaintDocument): Motion {
  return { paths: docPaths(doc), fps: doc.timeline.fps };
}

/**
 * Where a point of a piece (its own pixels: a trail's emitter) is in 3D at any time, fractions of
 * a frame included, as the camera at rest places it (the camera's moves only change how it's seen).
 */
export function emitterPath(doc: PaintDocument, pieceId: string, point: Point): EmitterPath {
  const motion = docMotion(doc);
  const p = doc.pieces.find((q) => q.id === pieceId);
  if (!p) return () => [0, 0, 0];
  return (t) => new Scene(doc.pieces, t, doc.space, motion).worldOf(p, point);
}

/** Every piece's pose at `frame`, as the picture's camera (at that frame) sees it, on the paths they follow. */
export function sceneOf(doc: PaintDocument, frame: number): Scene {
  return new Scene(doc.pieces, frame, doc.spaceAt(frame), docMotion(doc));
}

const keyOf = (f: Follow) => `${f.layerId}\n${f.objectId}\n${f.sub}`;

/**
 * The paths pieces followed as of the picture's last change, so when a change deletes one, the
 * pieces that followed it can keep the motion they had (see bakeFollow).
 */
export class FollowedPaths {
  private last = new Map<string, PathMeasure>();

  /** Note the paths the pieces follow now. */
  remember(doc: PaintDocument): void {
    this.last.clear();
    const paths = docPaths(doc);
    for (const p of doc.pieces) {
      if (!p.follow) continue;
      const m = paths(p.follow);
      if (m) this.last.set(keyOf(p.follow), m);
    }
  }

  /** Pieces whose path is gone now, with the path they followed before (null if it wasn't noted). */
  lost(doc: PaintDocument): { piece: Piece; path: PathMeasure | null }[] {
    const paths = docPaths(doc);
    return doc.pieces.filter((p) => p.follow && !paths(p.follow)).map((p) => ({ piece: p, path: this.last.get(keyOf(p.follow!)) ?? null }));
  }
}

const same = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

/**
 * A piece's motion path as a path it can follow: an anchor at each keyframe (one for a run of
 * keyframes where it stays put), the keyframes' bends as the anchors' handles, closed if it ends
 * where it started. With it, how far along the path each keyframe is, so following it keeps the
 * timing (a piece already moves along a bent motion path by distance). Null if it doesn't move.
 */
export function motionToPath(p: Piece): { sub: SubPath; progress: number[] } | null {
  const abs = (k: Keyframe, v: { x: number; y: number } | null) => v && { x: k.x + v.x, y: k.y + v.y };
  const anchors: PathAnchor[] = [];
  /** Which anchor each keyframe is at. */
  const at: number[] = [];
  p.keyframes.forEach((k, i) => {
    const last = anchors[anchors.length - 1];
    const first = i === 0;
    const end = i === p.keyframes.length - 1;
    // The bends that matter: arriving at a keyframe (not the first) and leaving it (not the last).
    const inn = first ? null : abs(k, k.in);
    const out = end ? null : abs(k, k.out);
    if (last && same(last, k) && !last.out && !inn) {
      anchors[anchors.length - 1] = { ...last, out, smooth: !!(last.in && out) };
    } else anchors.push({ x: k.x, y: k.y, in: inn, out, smooth: !!(inn && out) });
    at.push(anchors.length - 1);
  });
  // Ending where it started makes a loop (the start takes the bend arriving back at it).
  let closed = false;
  const n = anchors.length;
  if (n >= 3 && same(anchors[0], anchors[n - 1])) {
    anchors[0] = { ...anchors[0], in: anchors[n - 1].in, smooth: !!(anchors[n - 1].in && anchors[0].out) };
    anchors.pop();
    closed = true;
  }
  if (anchors.length < 2) return null;
  // How far along each anchor is, measured as a followed path is (segment by segment).
  const cum = [0];
  for (let i = 0; i + 1 < anchors.length; i++) cum.push(cum[i] + (measurePath({ anchors: [anchors[i], anchors[i + 1]], closed: false })?.length ?? 0));
  const total = closed ? cum[cum.length - 1] + (measurePath({ anchors: [anchors[anchors.length - 1], anchors[0]], closed: false })?.length ?? 0) : cum[cum.length - 1];
  if (total <= 1e-9) return null;
  const progress = at.map((a) => (a >= anchors.length ? 1 : cum[a] / total));
  return { sub: { anchors, closed }, progress };
}

/**
 * A following piece's motion as plain keyframes: one on every frame from its first keyframe to
 * its last, x and y where the path put it (and no progress: it follows nothing now), everything
 * else as it was, so every frame shows it exactly where it was. Spread out evenly if there would
 * be more keyframes than a piece can have.
 */
export function bakeFollow(p: Piece, path: PathMeasure): Keyframe[] {
  const f0 = p.keyframes[0].frame;
  const f1 = p.keyframes[p.keyframes.length - 1].frame;
  const step = Math.max(1, Math.ceil((f1 - f0 + 1) / MAX_KEYFRAMES));
  const key = (frame: number): Keyframe => {
    const s = pieceStateAt(p, frame);
    const at = path.at(s.progress);
    return { ...s, x: at.x, y: at.y, progress: 0, frame, easing: 'linear', in: null, out: null };
  };
  const out: Keyframe[] = [];
  for (let f = f0; f <= f1; f += step) out.push(key(f));
  if (out[out.length - 1].frame !== f1) out.push(key(f1));
  return out;
}
