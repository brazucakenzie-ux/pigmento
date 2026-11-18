import type { Point } from '../core/geometry';
import { matApply, matInvert } from '../core/matrix';
import type { Dab } from '../brush/dab';
import type { Command } from '../history/History';
import type { TileDelta } from '../raster/Surface';
import type { I18nKey } from '../../i18n';
import { stateMatrix, type PieceState } from './interpolate';
import { repeatAxes, type Piece } from './piece';

/**
 * How painting on a piece maps the canvas onto the piece's own pixels at one moment (the frame
 * shown): strokes are drawn in the piece's pixels, under the pointer, at the brush's size on the
 * canvas. A repeating piece's strokes run on past its edges into the next copy, and its dabs
 * fold back onto the one tile every copy shows.
 */
export interface PiecePaintMap {
  /** Canvas point → the piece's own pixels (not folded: past the edge of a repeating piece, it carries on). */
  toPiece(p: Point): Point;
  /** The piece's own pixels → canvas point (for the brush cursor). */
  toDoc(p: Point): Point;
  /** How many canvas pixels one piece pixel covers, across (the square root of its area). */
  scale: number;
  /** An angle on the canvas (radians, as dabs use them) as the angle in the piece's own pixels. */
  angle(a: number): number;
  /** A dab where it lands on the piece: folded into the tile, plus its copies across the seams it overlaps. */
  fold(d: Dab): Dab[];
}

const mod = (v: number, n: number): number => ((v % n) + n) % n;

/** Painting on `piece` as it is at state s, or null when it has no area (scaled to nothing). */
export function piecePaintMap(piece: Piece, s: PieceState): PiecePaintMap | null {
  const m = stateMatrix(s, piece.pivot);
  const inv = matInvert(m);
  const det = m[0] * m[3] - m[1] * m[2];
  if (!inv || Math.abs(det) < 1e-12) return null;
  const ax = repeatAxes(piece.repeat);
  const sx = ax.x ? s.scrollX : 0;
  const sy = ax.y ? s.scrollY : 0;
  const w = piece.src.width;
  const h = piece.src.height;
  const fold = (d: Dab): Dab[] => {
    const r = d.size / 2 + 1;
    const xs = ax.x ? edges(mod(d.x, w), w, r) : [d.x];
    const ys = ax.y ? edges(mod(d.y, h), h, r) : [d.y];
    const out: Dab[] = [];
    for (const y of ys) for (const x of xs) out.push({ ...d, x, y });
    return out;
  };
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
