import type { Point } from '../core/geometry';
import {
  frameApply,
  frameChain,
  frameInvert,
  localFrame,
  localParts,
  rootFrame,
  rootParts,
  type Frame,
  type Hinge,
} from './frames';
import type { Easing, Keyframe } from './interpolate';
import { cloneKeyframe, copyPieces, makeGroup, MAX_KEYFRAMES, type Piece } from './piece';
import { MAX_TREE, Scene } from './scene';
import { NEAR, type Space } from './space';

/**
 * Trees of linked pieces, as pure functions over a picture's piece list (each returns a new list
 * of new pieces where it changes any, so undo snapshots keep the old ones). A tree's pieces are
 * on one layer; its top is a group (made when a piece is first hinged to another) or a piece
 * other pieces simply follow. Hinges hang a piece off an edge of a piece of pixels, never a group.
 */

/** Why a link can't be made. */
export type LinkRefusal = 'missing' | 'layer' | 'loop' | 'full' | 'group';

export interface LinkResult {
  pieces: Piece[];
  /** A group made to carry the tree (its top), if one was. */
  group: Piece | null;
}

function byId(pieces: readonly Piece[]): Map<string, Piece> {
  return new Map(pieces.map((p) => [p.id, p]));
}

/** The piece p follows, if the link holds (see Scene.parentOf). */
function parentIn(map: Map<string, Piece>, p: Piece): Piece | null {
  if (!p.link || p.kind === 'group') return null;
  const q = map.get(p.link.parent);
  return q && q !== p && q.layerId === p.layerId ? q : null;
}

/** The pieces directly under `id`, in list order. */
export function childrenOf(pieces: readonly Piece[], id: string): Piece[] {
  const map = byId(pieces);
  return pieces.filter((p) => parentIn(map, p)?.id === id);
}

/** `id` and every piece under it, in list order. */
export function subtree(pieces: readonly Piece[], id: string): Piece[] {
  const map = byId(pieces);
  const inside = new Set<string>([id]);
  // Parents can come after their children in the list, so keep going until nothing joins.
  for (let grew = true; grew;) {
    grew = false;
    for (const p of pieces) {
      const q = parentIn(map, p);
      if (q && inside.has(q.id) && !inside.has(p.id)) {
        inside.add(p.id);
        grew = true;
      }
    }
  }
  return pieces.filter((p) => inside.has(p.id));
}

/** The top of the tree p is in (p itself when it follows nothing). */
export function rootOf(pieces: readonly Piece[], p: Piece): Piece {
  const map = byId(pieces);
  let top = p;
  for (let i = 0, q = parentIn(map, p); q && i < MAX_TREE; i++, q = parentIn(map, q)) top = q;
  return top;
}

/** Every piece in p's tree, in list order. */
export function treeOf(pieces: readonly Piece[], p: Piece): Piece[] {
  return subtree(pieces, rootOf(pieces, p).id);
}

/** True if p is under a group (whose opacity reaches it). */
export function underGroup(pieces: readonly Piece[], p: Piece): boolean {
  const map = byId(pieces);
  for (let i = 0, q = parentIn(map, p); q && i < MAX_TREE; i++, q = parentIn(map, q))
    if (q.kind === 'group') return true;
  return false;
}

/**
 * Pieces from a file (or anywhere else they can't be trusted), with every link that doesn't hold
 * dropped: to a missing piece, onto another layer, from a group, a hinge on a group, a loop, or a
 * tree with more pieces than one can hold.
 */
export function checkLinks(pieces: readonly Piece[]): Piece[] {
  const map = byId(pieces);
  const cut = new Set<string>();
  for (const p of pieces) {
    if (!p.link) continue;
    const q = parentIn(map, p);
    if (!q || (p.link.hinge && q.kind !== 'piece')) cut.add(p.id);
  }
  // Loops: walking up from a piece comes back round to it.
  for (const p of pieces) {
    const seen = new Set<string>([p.id]);
    for (
      let q = cut.has(p.id) ? null : parentIn(map, p);
      q && !cut.has(q.id);
      q = parentIn(map, q)
    ) {
      if (seen.has(q.id)) {
        cut.add(p.id);
        break;
      }
      seen.add(q.id);
    }
  }
  const kept = pieces.map((p) => (cut.has(p.id) ? { ...p, link: null } : p));
  // Trees too big: the pieces past the limit (in list order) are let go.
  const counts = new Map<string, number>();
  return kept.map((p) => {
    if (!p.link) return p;
    const top = rootOf(kept, p).id;
    const n = (counts.get(top) ?? 1) + 1;
    counts.set(top, n);
    return n > MAX_TREE ? { ...p, link: null } : p;
  });
}

/** Can `id` (and the pieces under it) be linked under `parentId`? */
function refusal(
  pieces: readonly Piece[],
  id: string,
  parentId: string,
  hinged: boolean,
  extra: number,
): LinkRefusal | null {
  const map = byId(pieces);
  const p = map.get(id);
  const parent = map.get(parentId);
  if (!p || !parent) return 'missing';
  if (p.layerId !== parent.layerId) return 'layer';
  if (p.kind === 'group' || (hinged && parent.kind !== 'piece')) return 'group';
  const moving = subtree(pieces, id);
  if (moving.some((q) => q.id === parentId)) return 'loop';
  const target = treeOf(pieces, parent);
  const already = target.some((q) => q.id === id);
  if (!already && target.length + moving.length + extra > MAX_TREE) return 'full';
  return null;
}

/** Keyframe values that place a piece, set to sit exactly on its parent's pixels (local identity). */
function placeNeutral(k: Keyframe, pivot: Point): Keyframe {
  return {
    ...cloneKeyframe(k),
    x: pivot.x,
    y: pivot.y,
    sx: 1,
    sy: 1,
    angle: 0,
    skew: 0,
    depth: 0,
    tilt: 0,
    turn: 0,
    in: null,
    out: null,
  };
}

/** 2D part of a frame's linear map (x and y against x and y), for carrying motion-path handles across. */
function handleMap(A: Readonly<Frame>): (v: Point | null) => Point | null {
  return (v) => v && { x: A[0] * v.x + A[1] * v.y, y: A[4] * v.x + A[5] * v.y };
}

/**
 * `id` follows `parentId` from now on, staying where it is at `frame`: its keyframes become
 * relative to the parent as it is at that frame, so its own motion carries on on top of the
 * parent's. The pieces under it come along.
 */
export function attach(
  pieces: readonly Piece[],
  id: string,
  parentId: string,
  frame: number,
  space: Space,
): Piece[] | LinkRefusal {
  const why = refusal(pieces, id, parentId, false, 0);
  if (why) return why;
  const map = byId(pieces);
  const p = map.get(id)!;
  const parent = map.get(parentId)!;
  const inv = frameInvert(new Scene(pieces, frame, space).pose(parent).frame);
  if (!inv) return 'missing';
  const carry = handleMap(inv);
  let near = { tilt: 0, turn: 0, angle: 0 };
  const keyframes = p.keyframes.map((k) => {
    const world = new Scene(pieces, k.frame, space).pose(p).frame;
    const parts = localParts(frameChain(inv, world), p.pivot, near);
    near = parts;
    return { ...cloneKeyframe(k), ...parts, in: carry(k.in), out: carry(k.out) };
  });
  return pieces.map((q) =>
    q.id === id ? { ...q, keyframes, link: { parent: parentId, hinge: null } } : q,
  );
}

/**
 * Hang `id` off `parentId`'s edge as `hinge` says, folded by `fold` (radians) on every keyframe.
 * A parent that follows nothing gets a group to carry the tree first (it takes the parent's
 * motion; the parent then sits still on it), so the tree turns as one about the group's pivot.
 */
export function hinge(
  pieces: readonly Piece[],
  id: string,
  parentId: string,
  h: Hinge,
  fold: number,
  newId: () => string,
): LinkResult | LinkRefusal {
  const map = byId(pieces);
  const parent = map.get(parentId);
  const needsGroup = !!parent && parent.kind === 'piece' && !parent.link;
  const why = refusal(pieces, id, parentId, true, needsGroup ? 1 : 0);
  if (why) return why;
  const p = map.get(id)!;
  let group: Piece | null = null;
  const out: Piece[] = [];
  for (const q of pieces) {
    if (q.id === parentId && needsGroup) {
      // The group moves as the parent did (its opacity stays with the parent, as does its scroll).
      group = makeGroup(
        newId(),
        '',
        q.layerId,
        q.home,
        q.pivot,
        q.keyframes.map((k) => ({ ...k, opacity: 1, scrollX: 0, scrollY: 0, fold: 0 })),
      );
      out.push(group, {
        ...q,
        keyframes: q.keyframes.map((k) => placeNeutral(k, q.pivot)),
        link: { parent: group.id, hinge: null },
      });
    } else if (q.id === id) {
      out.push({
        ...q,
        keyframes: q.keyframes.map((k) => ({ ...placeNeutral(k, p.pivot), fold })),
        link: { parent: parentId, hinge: { ...h } },
      });
    } else out.push(q);
  }
  return { pieces: out, group };
}

/**
 * `id` follows nothing any more, moving as it did: its place is baked into keyframes at every
 * frame where it or anything above it has one. The pieces under it stay with it; a group left
 * with no pieces goes.
 */
export function detach(pieces: readonly Piece[], id: string, space: Space): Piece[] {
  const map = byId(pieces);
  const p = map.get(id);
  if (!p || !parentIn(map, p)) return [...pieces];
  const chain: Piece[] = [];
  for (let q: Piece | null = p; q && chain.length < MAX_TREE; q = parentIn(map, q)) chain.push(q);
  const frames = [...new Set(chain.flatMap((q) => q.keyframes.map((k) => k.frame)))]
    .sort((a, b) => a - b)
    .slice(0, MAX_KEYFRAMES);
  const easingAt = (f: number): Easing => {
    for (const q of chain) {
      const k = q.keyframes.find((x) => x.frame === f);
      if (k) return k.easing;
    }
    return 'linear';
  };
  let near = { tilt: 0, turn: 0, angle: 0 };
  const keyframes = frames.map((f): Keyframe => {
    const pose = new Scene(pieces, f, space).pose(p);
    const parts = rootParts(pose.frame, p.pivot, space, near);
    near = parts;
    return {
      ...pose.state,
      ...parts,
      opacity: pose.opacity,
      fold: 0,
      frame: f,
      easing: easingAt(f),
      in: null,
      out: null,
    };
  });
  const freed = pieces.map((q) => (q.id === id ? { ...q, keyframes, link: null } : q));
  return pruneGroups(freed);
}

/** Without groups that have no pieces of pixels under them any more. */
export function pruneGroups(pieces: readonly Piece[]): Piece[] {
  let list = [...pieces];
  for (;;) {
    const empty = list.filter(
      (g) => g.kind === 'group' && !subtree(list, g.id).some((q) => q.kind === 'piece'),
    );
    if (!empty.length) return list;
    const gone = new Set(empty.flatMap((g) => subtree(list, g.id).map((q) => q.id)));
    list = list.filter((q) => !gone.has(q.id));
  }
}

/** Without `id` and every piece under it (and a group left empty by that). */
export function removeTree(pieces: readonly Piece[], id: string): Piece[] {
  const gone = new Set(subtree(pieces, id).map((q) => q.id));
  return pruneGroups(pieces.filter((q) => !gone.has(q.id)));
}

/**
 * A copy of `id` and the pieces under it, linked as they are, placed right after them; the copy
 * of `id` follows the same parent (so the tree must have room). Null when it hasn't.
 */
export function duplicateTree(
  pieces: readonly Piece[],
  id: string,
  newId: () => string,
): { pieces: Piece[]; copy: Piece } | null {
  const moving = subtree(pieces, id);
  if (!moving.length) return null;
  const p = moving.find((q) => q.id === id)!;
  if (p.link && treeOf(pieces, p).length + moving.length > MAX_TREE) return null;
  const copies = copyPieces(moving, newId, (q) => q.layerId);
  const top = copies[moving.indexOf(p)];
  top.link = p.link && { parent: p.link.parent, hinge: p.link.hinge && { ...p.link.hinge } };
  const last = pieces.indexOf(moving[moving.length - 1]);
  return {
    pieces: [...pieces.slice(0, last + 1), ...copies, ...pieces.slice(last + 1)],
    copy: top,
  };
}

/** The whole tree `id` is in, moved to layer `layerId` (on top of that layer's pieces). */
export function moveTree(pieces: readonly Piece[], id: string, layerId: string): Piece[] {
  const p = pieces.find((q) => q.id === id);
  if (!p) return [...pieces];
  const tree = new Set(treeOf(pieces, p).map((q) => q.id));
  const moved = pieces.filter((q) => tree.has(q.id)).map((q) => ({ ...q, layerId }));
  return [...pieces.filter((q) => !tree.has(q.id)), ...moved];
}

/**
 * Keyframes of a piece that follows another, after moving its pivot to `next` (its own pixels),
 * so it stays exactly where it was on every keyframe: each takes the place the new pivot had.
 */
export function movePivotLocal(
  keyframes: readonly Keyframe[],
  pivot: Point,
  next: Point,
): Keyframe[] {
  return keyframes.map((k) => {
    const [x, y, depth] = frameApply(localFrame(k, pivot), next.x, next.y);
    return { ...cloneKeyframe(k), x, y, depth };
  });
}

/**
 * A group's pivot moved to the middle of its pieces (the middle of their boxes in the group's own
 * space, depth included) as they are at `frame`, so the group turns about it; nothing moves on any
 * keyframe. The group's keyframes take the new pivot's place, and the pieces right under it move
 * back by its depth (they're placed relative to the group's own plane, which moves with it).
 */
export function centrePivot(pieces: readonly Piece[], groupId: string, frame: number, space: Space): Piece[] {
  const map = byId(pieces);
  const g = map.get(groupId);
  if (!g || g.kind !== 'group') return [...pieces];
  const scene = new Scene(pieces, frame, space);
  const inv = frameInvert(scene.pose(g).frame);
  const members = subtree(pieces, groupId).filter((p) => p.kind === 'piece');
  if (!inv || !members.length) return [...pieces];
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of members) {
    const { width: w, height: h } = p.src;
    for (const q of [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: 0, y: h }, { x: w, y: h }]) {
      const L = frameApply(inv, ...scene.worldOf(p, q));
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], L[i]);
        hi[i] = Math.max(hi[i], L[i]);
      }
    }
  }
  const [mx, my, mz] = [0, 1, 2].map((i) => (lo[i] + hi[i]) / 2);
  // Already in the middle (a box as made): nothing to change.
  const tiny = 1e-6 * Math.max(1, ...hi.map((v, i) => v - lo[i]));
  if (Math.abs(mx - g.pivot.x) < tiny && Math.abs(my - g.pivot.y) < tiny && Math.abs(mz) < tiny) return [...pieces];
  const { cx, cy, f } = space;
  const keyframes = g.keyframes.map((k) => {
    // Where the middle is in 3D on this keyframe becomes the group's place.
    const P = frameApply(rootFrame(k, g.pivot, space), mx, my, mz);
    const depth = Math.max(P[2], -f * (1 - NEAR));
    const s = f / (f + depth);
    return { ...cloneKeyframe(k), x: cx + (P[0] - cx) * s, y: cy + (P[1] - cy) * s, depth };
  });
  return pieces.map((p) => {
    if (p.id === groupId) return { ...p, pivot: { x: mx, y: my }, keyframes };
    if (p.link?.parent === groupId && !p.link.hinge) return { ...p, keyframes: p.keyframes.map((k) => ({ ...cloneKeyframe(k), depth: k.depth - mz })) };
    return p;
  });
}
