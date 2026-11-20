import type { PaintDocument } from '../doc/Document';
import { shapeOutline } from '../vector/convert';
import { walkShapes, type VectorShape } from '../vector/model';
import { measurePath, type PathMeasure } from './pathMeasure';
import { MAX_KEYFRAMES, pieceStateAt, type Follow, type Piece } from './piece';
import type { Keyframe } from './interpolate';
import { Scene, type Motion } from './scene';

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
