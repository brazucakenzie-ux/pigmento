import type { Point } from '@engine/core/geometry';
import type { Edge } from '@engine/anim/frames';
import type { Easing } from '@engine/anim/interpolate';
import type { LoopMode } from '@engine/anim/timeline';
import type { Back, Piece, PieceLoop, Repeat } from '@engine/anim/piece';
import { t } from '../../i18n';
import { engine } from '../state/engine';
import { updateSettings, useUi } from '../state/store';
import { bool, chooseLayer, int, num, pixelLayer, str, type Handler } from './assistantArgs';
import { placeImageFrom } from './files';

/**
 * The window's side of animating (8.12 on): pieces, keyframes, and the animation as a whole.
 * Working at a frame goes to it and shows the timeline, as a person would. Values come in the
 * Animate options bar's own units, as the user sees them (degrees, scale × 100, opacity × 100).
 */

/** A piece the assistant named. */
export function pieceArg(v: unknown): Piece {
  const p = engine.anim.piece(str(v) ?? null);
  if (!p) throw new Error(`There’s no piece ${String(v)}. get_picture_info lists them (under animation).`);
  return p;
}

/** A frame the assistant gave (from 1), as the engine counts (from 0); `length` if the animation will be that long. */
export function frameArg(v: unknown, length = engine.doc.timeline.length): number | undefined {
  const f = int(v);
  if (f === undefined) return undefined;
  if (f < 1 || f > length) throw new Error(`The animation has ${length} frame${length === 1 ? '' : 's'}: frame can be 1 to ${length} (set_animation changes its length).`);
  return f - 1;
}

/** Show the timeline, if it's hidden. */
function showTimeline(): void {
  const a = useUi.getState().settings.anim;
  if (!a.timeline) updateSettings({ anim: { ...a, timeline: true } });
}

/** Go to a frame, as a person would to work there. */
export function goTo(frame: number): void {
  engine.anim.setFrame(frame);
  showTimeline();
}

/** Make an engine change that says why when it can't (to the user, as a notice): the assistant is told the same. */
export function explained(fn: () => boolean, fallback: string): void {
  const heard: { why: string | null } = { why: null };
  const stop = engine.on('notice', (n) => (heard.why = t(n.key, n.params)));
  try {
    if (!fn()) throw new Error(heard.why ?? fallback);
  } finally {
    stop();
  }
}

const OPPOSITE: Record<Edge, Edge> = { n: 's', s: 'n', e: 'w', w: 'e' };
const pointOf = (v: unknown): Point | null => {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const [x, y] = [num(o.x), num(o.y)];
  return x === undefined || y === undefined ? null : { x, y };
};

type Fields = Parameters<typeof engine.anim.setFields>[0];

export const ANIM_HANDLERS: Record<string, Handler> = {
  make_piece: (args) => {
    const from = str(args.from) ?? '';
    const keep = bool(args.keepOriginal) ?? false;
    const name = str(args.name);
    if (from === 'selection' || from === 'layer') {
      chooseLayer(args.layer);
      pixelLayer();
      if (from === 'selection' && !engine.doc.selection) throw new Error('Select what to animate first (select), or make a piece from the whole layer (from: layer).');
    }
    const path = str(args.path) ?? '';
    if (from === 'image' && !path) throw new Error('Placing an image needs its path.');
    const box = { w: int(args.width) ?? 200, h: int(args.height) ?? 200, d: int(args.depth) ?? 200 };
    return {
      label: 'assistant.step.make_piece',
      apply: async () => {
        const before = new Set(engine.doc.pieces.map((p) => p.id));
        if (from === 'selection') explained(() => engine.animateSelection(keep), 'Pigmento couldn’t make a piece from the selection.');
        else if (from === 'layer') explained(() => engine.pieceFromLayer(keep), 'Pigmento couldn’t make a piece from the layer.');
        else if (from === 'box') explained(() => engine.anim.makeBox(box), 'Pigmento couldn’t make the box.');
        else if (!(await placeImageFrom(path))) throw new Error(`Pigmento couldn’t place ${path}.`);
        const made = engine.doc.pieces.filter((p) => !before.has(p.id));
        const main = made.find((p) => p.kind === 'group') ?? made[0];
        if (!main) throw new Error('No piece was made.');
        if (name) engine.anim.rename(main.id, name);
        showTimeline();
        const faces = made.length > 1 ? ` with ${made.length - 1} faces` : '';
        return { text: `Made the piece “${main.name}” (${main.id})${faces}.`, data: { piece: main.id, pieces: made.map((p) => ({ id: p.id, name: p.name, kind: p.kind })) } };
      },
    };
  },

  set_keyframe: (args) => {
    const p = pieceArg(args.piece);
    const f = frameArg(args.frame)!;
    const remove = bool(args.remove) === true;
    const keys = () => p.keyframes.map((k) => k.frame + 1);
    if (remove && !p.keyframes.some((k) => k.frame === f)) throw new Error(`“${p.name}” has no keyframe at frame ${f + 1}; it has them at ${keys().join(', ')}.`);
    // In the options bar's units.
    const change: Fields = {};
    const set = <K extends keyof Fields>(k: K, v: Fields[K] | undefined) => {
      if (v !== undefined) change[k] = v;
    };
    const scale = num(args.scale);
    set('x', num(args.x));
    set('y', num(args.y));
    set('w', scale !== undefined ? scale * 100 : num(args.scaleX) !== undefined ? num(args.scaleX)! * 100 : undefined);
    set('h', scale !== undefined ? scale * 100 : num(args.scaleY) !== undefined ? num(args.scaleY)! * 100 : undefined);
    set('angle', num(args.rotate));
    set('skew', num(args.skew));
    set('opacity', num(args.opacity) !== undefined ? num(args.opacity)! * 100 : undefined);
    set('scrollX', num(args.scrollX));
    set('scrollY', num(args.scrollY));
    set('depth', num(args.depth));
    set('tilt', num(args.tilt));
    set('turn', num(args.turn));
    set('fold', num(args.fold));
    set('easing', str(args.easing) as Easing | undefined);
    const curve: { in?: Point | null; out?: Point | null } = {};
    if (args.curveIn !== undefined) curve.in = args.curveIn === null ? null : pointOf(args.curveIn);
    if (args.curveOut !== undefined) curve.out = args.curveOut === null ? null : pointOf(args.curveOut);
    if (!remove && !Object.keys(change).length && !Object.keys(curve).length) throw new Error('Say what to set at that frame (x, y, scale, rotate, opacity…), or remove: true.');
    return {
      label: 'assistant.step.set_keyframe',
      apply: () => {
        goTo(f);
        engine.anim.select(p.id);
        if (remove) explained(() => engine.anim.removeKey(p.id, f), `The keyframe at frame ${f + 1} couldn’t be removed (a piece keeps at least one).`);
        else {
          if (Object.keys(change).length) engine.anim.setFields(change);
          if (Object.keys(curve).length) engine.anim.setKey(p.id, f, curve);
        }
        const now = engine.anim.piece(p.id) ?? p;
        return { text: `${remove ? 'Removed the keyframe' : 'Keyframe'} at frame ${f + 1} for “${now.name}”; it has keyframes at ${now.keyframes.map((k) => k.frame + 1).join(', ')}.`, data: { frame: f + 1, keyframes: now.keyframes.map((k) => k.frame + 1) } };
      },
    };
  },

  set_piece: (args) => {
    const p = pieceArg(args.piece);
    const follow = str(args.follow);
    const target = follow && follow !== 'none' ? pieceArg(follow) : null;
    const hingeArg = typeof args.hinge === 'object' && args.hinge !== null ? (args.hinge as Record<string, unknown>) : null;
    const hingeTo = hingeArg ? pieceArg(hingeArg.to) : null;
    const pivot = args.pivot === 'centre' ? 'centre' : pointOf(args.pivot);
    return {
      label: 'assistant.step.set_piece',
      apply: () => {
        const a = engine.anim;
        a.select(p.id);
        const name = str(args.name);
        if (name) a.rename(p.id, name);
        const loop = str(args.loop) as PieceLoop | undefined;
        if (loop) a.setPieceLoop(p.id, loop);
        if (follow === 'none') a.detach(p.id);
        else if (target) explained(() => a.attach(p.id, target.id), `“${p.name}” can’t follow “${target.name}”.`);
        if (hingeArg && hingeTo) {
          const edge = (str(hingeArg.edge) ?? 's') as Edge;
          const childEdge = (str(hingeArg.childEdge) as Edge | undefined) ?? OPPOSITE[edge];
          explained(() => a.hinge(p.id, hingeTo.id, { edge, childEdge, offset: 0, along: 1, across: 1 }, ((num(hingeArg.fold) ?? 0) * Math.PI) / 180), `“${p.name}” can’t hang from “${hingeTo.name}”.`);
        }
        const back = str(args.back) as Back | undefined;
        if (back) a.setBack(p.id, back);
        const shade = num(args.shade);
        if (shade !== undefined) a.setShade(p.id, shade);
        const repeat = str(args.repeat) as Repeat | undefined;
        if (repeat) a.setRepeat(p.id, repeat);
        if (pivot === 'centre') explained(() => a.centrePivot(p.id), `“${p.name}” isn’t in a group (centre applies to a group’s pivot).`);
        else if (pivot) a.setPivot(p.id, pivot);
        if (bool(args.delete) === true) {
          a.remove(p.id);
          return { text: `Deleted the piece “${p.name}”.` };
        }
        const now = a.piece(p.id) ?? p;
        return { text: `Set the piece “${now.name}”.`, data: { piece: now.id, follows: now.link?.parent ?? null, hinged: !!now.link?.hinge, loop: now.loop } };
      },
    };
  },

  set_animation: (args) => {
    const tl = engine.doc.timeline;
    const length = int(args.length) ?? tl.length;
    const frame = frameArg(args.frame, length);
    const cam = typeof args.camera === 'object' && args.camera !== null ? (args.camera as Record<string, unknown>) : null;
    const move = typeof args.cameraMove === 'object' && args.cameraMove !== null ? (args.cameraMove as Record<string, unknown>) : null;
    const moveFrame = move ? frameArg(move.frame, length)! : undefined;
    const light = typeof args.light === 'object' && args.light !== null ? (args.light as Record<string, unknown>) : null;
    const play = bool(args.play);
    return {
      label: 'assistant.step.set_animation',
      apply: () => {
        const a = engine.anim;
        const timeline: { length?: number; fps?: number; loop?: LoopMode } = {};
        if (args.length !== undefined) timeline.length = length;
        if (int(args.fps) !== undefined) timeline.fps = int(args.fps);
        if (str(args.loop)) timeline.loop = str(args.loop) as LoopMode;
        if (Object.keys(timeline).length) a.setTimeline(timeline);
        if (cam) a.setCamera({ ...(num(cam.x) !== undefined ? { x: num(cam.x) } : {}), ...(num(cam.y) !== undefined ? { y: num(cam.y) } : {}), ...(num(cam.strength) !== undefined ? { strength: num(cam.strength) } : {}) });
        if (move && moveFrame !== undefined) {
          goTo(moveFrame);
          const k: { panX?: number; panY?: number; push?: number; easing?: Easing } = {};
          for (const key of ['panX', 'panY', 'push'] as const) if (num(move[key]) !== undefined) k[key] = num(move[key]);
          if (str(move.easing)) k.easing = str(move.easing) as Easing;
          a.setCameraKey(moveFrame, k);
        }
        if (light) a.setLight({ ...(num(light.angle) !== undefined ? { angle: num(light.angle) } : {}), ...(num(light.height) !== undefined ? { height: num(light.height) } : {}) });
        if (frame !== undefined) goTo(frame);
        if (play === true) {
          showTimeline();
          a.play();
        } else if (play === false) a.stop();
        const now = engine.doc.timeline;
        return {
          text: `The animation is ${now.length} frames at ${now.fps} a second, played ${now.loop === 'once' ? 'once' : now.loop === 'pingpong' ? 'back and forth' : 'round and round'}, showing frame ${now.frame + 1}${play ? ' and playing' : ''}.`,
          data: { length: now.length, fps: now.fps, loop: now.loop, frame: now.frame + 1, camera: { ...engine.doc.camera }, light: { ...engine.doc.light } },
        };
      },
    };
  },
};
