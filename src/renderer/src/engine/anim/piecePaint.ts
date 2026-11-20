import type { Point } from '../core/geometry';
import { matApply, matInvert } from '../core/matrix';
import type { Dab } from '../brush/dab';
import type { Command } from '../history/History';
import type { TileDelta } from '../raster/Surface';
import type { I18nKey } from '../../i18n';
import { repeatAxes, type Piece } from './piece';
import type { Scene } from './scene';
import { project, unproject } from './space';

/**
 * How painting on a piece maps the canvas onto the piece's own pixels at one moment (the frame
 * shown): strokes are drawn in the piece's pixels, under the pointer, at the brush's size on the
 * canvas. A repeating piece's strokes run on past its edges into the next copy, and its dabs
 * fold back onto the one tile every copy shows.
 */
export interface PiecePaintMap {
  /**
   * Canvas point → the piece's own pixels (not folded: past the edge of a repeating piece, it
   * carries on), or null where the sheet isn't (beyond its horizon, behind the camera).
   */
  toPiece(p: Point): Point | null;
  /** The piece's own pixels → canvas point (for the brush cursor), or null behind the camera. */
  toDoc(p: Point): Point | null;
  /**
   * How many canvas pixels one piece pixel covers, across (the square root of its area), where
   * the stroke starts: in 3D it changes over the sheet, so a stroke keeps the size it started with.
   */
  scale: number;
  /** An angle on the canvas (radians, as dabs use them) as the angle in the piece's own pixels. */
  angle(a: number): number;
  /** A dab where it lands on the piece: folded into the tile, plus its copies across the seams it overlaps. */
  fold(d: Dab): Dab[];
}

const mod = (v: number, n: number): number => ((v % n) + n) % n;

/** Seen this close to edge-on (a piece pixel spread over this many canvas pixels or squeezed this small), it isn't painted. */
const EDGE_ON = 1e-3;

/**
 * Painting on `piece` as `scene` has it, for a stroke starting at canvas point `at`; null when it
 * can't be painted there (scaled to nothing, seen edge-on, or not under `at`).
 */
export function piecePaintMap(piece: Piece, scene: Scene, at: Point | null = null): PiecePaintMap | null {
  const w = piece.src.width;
  const h = piece.src.height;
  const { placement: pl, state: s } = scene.pose(piece);
  const ax = repeatAxes(piece.repeat);
  const sx = ax.x ? s.scrollX : 0;
  const sy = ax.y ? s.scrollY : 0;
  const fold = (d: Dab): Dab[] => {
    const r = d.size / 2 + 1;
    const xs = ax.x ? edges(mod(d.x, w), w, r) : [d.x];
    const ys = ax.y ? edges(mod(d.y, h), h, r) : [d.y];
    const out: Dab[] = [];
    for (const y of ys) for (const x of xs) out.push({ ...d, x, y });
    return out;
  };
  if (pl.affine) {
    const m = pl.affine;
    const inv = matInvert(m);
    const det = m[0] * m[3] - m[1] * m[2];
    if (!inv || Math.abs(det) < 1e-12) return null;
    return {
      toPiece: (p) => {
        const q = matApply(inv, p.x, p.y);
        return { x: q.x - sx, y: q.y - sy };
      },
      toDoc: (p) => matApply(m, p.x + sx, p.y + sy),
      scale: Math.sqrt(Math.abs(det)),
      angle: (a) => {
        // The direction on the canvas, carried back into the piece.
        const v = { x: inv[0] * Math.cos(a) + inv[2] * Math.sin(a), y: inv[1] * Math.cos(a) + inv[3] * Math.sin(a) };
        return Math.atan2(v.y, v.x);
      },
      fold,
    };
  }
  // In 3D: through the homography. Size and angle come from how the sheet is stretched under `at`.
  const inv = pl.inv;
  const start = at ?? project(pl, { x: w / 2, y: h / 2 });
  if (!inv || !start) return null;
  const z = inv[6] * start.x + inv[7] * start.y + inv[8];
  if (!(z > 0)) return null;
  const u = (inv[0] * start.x + inv[1] * start.y + inv[2]) / z;
  const v = (inv[3] * start.x + inv[4] * start.y + inv[5]) / z;
  // The inverse's Jacobian there: piece pixels per canvas pixel along x and y.
  const j = [(inv[0] - u * inv[6]) / z, (inv[1] - u * inv[7]) / z, (inv[3] - v * inv[6]) / z, (inv[4] - v * inv[7]) / z];
  const det = j[0] * j[3] - j[1] * j[2];
  if (!Number.isFinite(det) || Math.abs(det) < EDGE_ON * EDGE_ON || Math.abs(det) > 1 / (EDGE_ON * EDGE_ON)) return null;
  return {
    toPiece: (p) => {
      const q = unproject(pl, p);
      return q && { x: q.x - sx, y: q.y - sy };
    },
    toDoc: (p) => project(pl, { x: p.x + sx, y: p.y + sy }),
    scale: 1 / Math.sqrt(Math.abs(det)),
    angle: (a) => Math.atan2(j[2] * Math.cos(a) + j[3] * Math.sin(a), j[0] * Math.cos(a) + j[1] * Math.sin(a)),
    fold,
  };
}

/** A position folded into 0…n, and its copies one tile either way when the dab (radius r) reaches over. */
function edges(v: number, n: number, r: number): number[] {
  const out = [v];
  if (v - r < 0) out.push(v + n);
  if (v + r > n) out.push(v - n);
  return out;
}

/** What a painted piece needs from the engine when its pixels change back or forth. */
export interface PiecePixelsHost {
  piecePixelsChanged(piece: Piece): void;
}

/** One stroke (or fill) on a piece's own pixels: swapping its tiles undoes and redoes it. */
export class PiecePixelsCommand implements Command {
  readonly bytes: number;

  constructor(
    readonly label: I18nKey,
    private readonly host: PiecePixelsHost,
    private readonly piece: Piece,
    private readonly delta: TileDelta,
  ) {
    this.bytes = delta.bytes;
  }

  undo(): void {
    this.delta.swap();
    this.host.piecePixelsChanged(this.piece);
  }

  redo(): void {
    this.delta.swap();
    this.host.piecePixelsChanged(this.piece);
  }
}
