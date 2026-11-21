import type { RGBA } from '../core/color';
import type { Rect } from '../core/geometry';
import type { PaintDocument } from '../doc/Document';
import { brushRegistry } from '../brush/BrushRegistry';
import { forEachDabPixel, dabShapeOf } from '../brush/dab';
import { makeTip, sampleMask, tipLevel, type Mask, type TipMask } from '../brush/tips';
import { over, type PixelView } from '../raster/pixels';
import { emitterPath } from './follow';
import type { Piece } from './piece';
import { projectWorld } from './space';
import { echoCopies, trailPuffs, type EchoCopy, type Trail } from './trail';

/**
 * Trails as they're drawn: puffs seen by the camera at the frame (in 3D they face it at their
 * depth, so they shrink with distance), as quads stamped with their brush's tip, and echoes as
 * the frames to draw the piece again at. Shared by the GPU (the screen and animation exports) and
 * the CPU (flattening, still exports, the colour picker), which sample the same tip the same way.
 */

/** One puff on the canvas: its middle, half its length along its angle (a) and half its width across it (b), its colour (straight) and how much of it shows. */
export interface PuffQuad {
  readonly x: number;
  readonly y: number;
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly color: RGBA;
  /** Its opacity times its colour's alpha (0 … 1). */
  readonly alpha: number;
}

/** A trail at a frame, ready to draw. */
export interface TrailDrawing {
  readonly trail: Trail;
  readonly puffs: PuffQuad[];
  readonly echoes: EchoCopy[];
}

/** Pixels across a puff tip (big puffs are smooth blobs or pictures scaled up; small ones use its smaller copies). */
export const TIP_SIZE = 128;

const tips = new Map<string, { settings: object; tip: TipMask }>();

/** The tip a brush stamps puffs with, as a square greyscale mask (a soft round one if there's no such brush). */
export function puffTip(brushId: string): TipMask {
  const def = brushRegistry.get(brushId) ?? brushRegistry.get('round-soft');
  const settings = def?.settings ?? null;
  const hit = tips.get(brushId);
  if (hit && settings && hit.settings === settings) return hit.tip;
  const data = new Uint8Array(TIP_SIZE * TIP_SIZE);
  const shape = settings ? dabShapeOf(settings) : { tip: 'round' as const, pixel: false, texture: null };
  const dab = { x: TIP_SIZE / 2, y: TIP_SIZE / 2, size: TIP_SIZE - 2, angle: settings ? (settings.angle * Math.PI) / 180 : 0, roundness: settings?.roundness ?? 1, hardness: settings ? settings.hardness : 0, alpha: 1, color: { r: 0, g: 0, b: 0, a: 255 } };
  forEachDabPixel(dab, { ...shape, pixel: false, texture: null }, { x: 0, y: 0, w: TIP_SIZE, h: TIP_SIZE }, (x, y, cov) => {
    data[y * TIP_SIZE + x] = Math.round(cov * 255);
  });
  const tip = makeTip({ w: TIP_SIZE, h: TIP_SIZE, data });
  if (settings) tips.set(brushId, { settings, tip });
  return tip;
}

/** The copy of a puff tip a puff `size` pixels across is drawn from (the GPU's mip level, by the same rule). */
export function puffTipLevel(tip: TipMask, size: number): Mask {
  return tipLevel(tip, size);
}

/** A piece's trails at `frame`, as drawn (in its list order: later ones over earlier ones). */
export function pieceTrailsAt(doc: PaintDocument, p: Piece, frame: number): TrailDrawing[] {
  if (!p.trails.length) return [];
  const space = doc.spaceAt(frame);
  const fps = doc.timeline.fps;
  return p.trails.map((trail) => {
    if (trail.kind === 'echo') return { trail, puffs: [], echoes: echoCopies(trail, frame) };
    const puffs: PuffQuad[] = [];
    for (const pf of trailPuffs(trail, emitterPath(doc, p.id, trail.emitter), frame, fps)) {
      const at = projectWorld(pf.at, space);
      if (!at) continue;
      // The camera's scale at the puff's depth.
      const k = space.f / (pf.at[2] + space.f - space.pz);
      const len = (pf.size * pf.stretch * k) / 2;
      const wid = (pf.size * k) / 2;
      const c = Math.cos(pf.angle);
      const s = Math.sin(pf.angle);
      const alpha = pf.opacity * (pf.color.a / 255);
      if (alpha <= 0 || wid <= 0) continue;
      puffs.push({ x: at.x, y: at.y, ax: c * len, ay: s * len, bx: -s * wid, by: c * wid, color: pf.color, alpha });
    }
    return { trail, puffs, echoes: [] };
  });
}

/** The box a puff can touch (whole pixels). */
export function puffBounds(q: PuffQuad): Rect {
  const ex = Math.abs(q.ax) + Math.abs(q.bx);
  const ey = Math.abs(q.ay) + Math.abs(q.by);
  const x = Math.floor(q.x - ex) - 1;
  const y = Math.floor(q.y - ey) - 1;
  return { x, y, w: Math.ceil(q.x + ex) + 1 - x, h: Math.ceil(q.y + ey) + 1 - y };
}

/**
 * Paint puffs (oldest first) into a view inside r, each its tip's coverage times its alpha, laid
 * over what's there: the CPU's way of drawing them, matching the GPU's within a little.
 */
export function paintPuffs(view: PixelView, r: Rect, puffs: readonly PuffQuad[], tip: TipMask): void {
  const vw = view.stride;
  const vh = view.data.length / 4 / vw;
  for (const q of puffs) {
    const b = puffBounds(q);
    const x0 = Math.max(b.x, r.x, view.ox);
    const y0 = Math.max(b.y, r.y, view.oy);
    const x1 = Math.min(b.x + b.w, r.x + r.w, view.ox + vw);
    const y1 = Math.min(b.y + b.h, r.y + r.h, view.oy + vh);
    if (x1 <= x0 || y1 <= y0) continue;
    const la = q.ax * q.ax + q.ay * q.ay;
    const lb = q.bx * q.bx + q.by * q.by;
    if (la <= 0 || lb <= 0) continue;
    const level = puffTipLevel(tip, 2 * Math.sqrt(Math.max(la, lb)));
    const { r: cr, g: cg, b: cb } = q.color;
    for (let y = y0; y < y1; y++) {
      const dy = y + 0.5 - q.y;
      let i = ((y - view.oy) * vw + (x0 - view.ox)) * 4;
      for (let x = x0; x < x1; x++, i += 4) {
        const dx = x + 0.5 - q.x;
        // Along and across the puff, -1 … 1.
        const u = (dx * q.ax + dy * q.ay) / la;
        const v = (dx * q.bx + dy * q.by) / lb;
        if (u <= -1 || u >= 1 || v <= -1 || v >= 1) continue;
        const cov = sampleMask(level, (u + 1) / 2, (v + 1) / 2);
        if (cov > 0) over(view.data, i, cr, cg, cb, cov * q.alpha);
      }
    }
  }
}
