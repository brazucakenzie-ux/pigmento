import { lerp } from '../core/geometry';
import { ease, type Easing } from './interpolate';

/**
 * Camera moves: the camera that sees pieces in 3D can slide across the picture (pan) and move
 * in towards it or back (push), keyed on the timeline. Pieces stay where they are in 3D, so the
 * near ones slide past faster than the far ones (parallax); the layers' own pixels don't move.
 */
export interface CameraMove {
  /** How far the camera has slid across and down, in document pixels. */
  panX: number;
  panY: number;
  /** How far it has moved in towards the canvas (negative: back from it), in document pixels. */
  push: number;
}

export interface CameraKey extends CameraMove {
  frame: number;
  /** Easing from this keyframe to the next. */
  easing: Easing;
}

export const NO_MOVE: CameraMove = { panX: 0, panY: 0, push: 0 };
/** Furthest the camera can slide or push, either way. */
export const MAX_CAMERA_MOVE = 1e6;
export const MAX_CAMERA_KEYS = 2000;

/** Where the camera is at `frame` (fractional frames are fine): held before the first key and after the last. */
export function cameraMoveAt(keys: readonly CameraKey[], frame: number): CameraMove {
  if (!keys.length) return NO_MOVE;
  const first = keys[0];
  if (frame <= first.frame) return pick(first);
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return pick(last);
  let i = 0;
  while (keys[i + 1].frame <= frame) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const e = ease(a.easing, (frame - a.frame) / (b.frame - a.frame));
  return { panX: lerp(a.panX, b.panX, e), panY: lerp(a.panY, b.panY, e), push: lerp(a.push, b.push, e) };
}

function pick(k: CameraMove): CameraMove {
  return { panX: k.panX, panY: k.panY, push: k.push };
}

const clean = (v: number) => (Number.isFinite(v) ? Math.max(-MAX_CAMERA_MOVE, Math.min(MAX_CAMERA_MOVE, v)) : 0);

/**
 * Keys with `change` at `frame` (auto-key): that key changed, or a new one there starting from
 * where the camera is at that frame (keeping the easing of the stretch it splits).
 */
export function setCameraKey(keys: readonly CameraKey[], frame: number, change: Partial<Omit<CameraKey, 'frame'>>): CameraKey[] {
  const out = keys.map((k) => ({ ...k }));
  const at = out.findIndex((k) => k.frame === frame);
  const tidy = (k: CameraKey): CameraKey => ({ ...k, panX: clean(k.panX), panY: clean(k.panY), push: clean(k.push) });
  if (at >= 0) {
    out[at] = tidy({ ...out[at], ...change });
    return out;
  }
  const before = [...keys].reverse().find((k) => k.frame < frame);
  out.push(tidy({ ...cameraMoveAt(keys, frame), frame, easing: before?.easing ?? 'linear', ...change }));
  return out.sort((a, b) => a.frame - b.frame);
}

/** Without the key at `frame` (the camera may have none: then it doesn't move). Null when there's none there. */
export function removeCameraKey(keys: readonly CameraKey[], frame: number): CameraKey[] | null {
  if (!keys.some((k) => k.frame === frame)) return null;
  return keys.filter((k) => k.frame !== frame).map((k) => ({ ...k }));
}

/** The key at `from` moved to `to`, or null when there's none at `from` or `to` is taken. */
export function moveCameraKey(keys: readonly CameraKey[], from: number, to: number): CameraKey[] | null {
  const at = keys.findIndex((k) => k.frame === from);
  if (at < 0 || to < 0 || !Number.isInteger(to) || (to !== from && keys.some((k) => k.frame === to))) return null;
  const out = keys.map((k) => ({ ...k }));
  out[at].frame = to;
  return out.sort((a, b) => a.frame - b.frame);
}
