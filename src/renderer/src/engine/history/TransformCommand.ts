import type { PaintDocument } from '../doc/Document';
import { Surface } from '../raster/Surface';
import { flipH, flipV, rotate90, type ImageBuf } from '../raster/transform';
import { transformSaved } from '../doc/savedSelections';
import { turnGuides } from '../doc/guides';
import { transformNode } from '../vector/model';
import { transformCamera, transformCameraKeys, transformPieces } from '../anim/pieceTransform';
import type { Mat } from '../core/matrix';
import type { I18nKey } from '../../i18n';
import type { CommandHost } from './commands';
import type { Command } from './History';

export type LosslessOp = { kind: 'flip'; axis: 'h' | 'v' } | { kind: 'rotate'; quarterTurns: number };

function applyToImage(op: LosslessOp, img: ImageBuf, inverse: boolean): ImageBuf {
  if (op.kind === 'flip') return op.axis === 'h' ? flipH(img) : flipV(img);
  return rotate90(img, inverse ? -op.quarterTurns : op.quarterTurns);
}

/** The same flip or quarter turn as a matrix on a w×h canvas (for shape objects). */
function losslessMatrix(op: LosslessOp, w: number, h: number): Mat {
  if (op.kind === 'flip') return op.axis === 'h' ? [-1, 0, 0, 1, w, 0] : [1, 0, 0, -1, 0, h];
  const q = ((op.quarterTurns % 4) + 4) % 4;
  // Clockwise: 90° maps (x, y) → (h − y, x); 180° → (w − x, h − y); 270° → (y, w − x).
  if (q === 1) return [0, 1, -1, 0, h, 0];
  if (q === 2) return [-1, 0, 0, -1, w, h];
  if (q === 3) return [0, -1, 1, 0, 0, w];
  return [1, 0, 0, 1, 0, 0];
}

/** Apply a lossless whole-image op to every layer (and the document size). */
export function applyLossless(doc: PaintDocument, op: LosslessOp, inverse: boolean): void {
  // A quarter turn swaps the document's width and height.
  const swap = op.kind === 'rotate' && op.quarterTurns % 2 !== 0;
  const nw = swap ? doc.height : doc.width;
  const nh = swap ? doc.width : doc.height;
  for (const layer of doc.rasterLayers()) {
    layer.mapSurfaces((s) => {
      const out = applyToImage(op, { w: s.width, h: s.height, data: s.toRGBA() }, inverse);
      return Surface.fromRGBA(out.w, out.h, out.data);
    });
  }
  doc.savedSelections = transformSaved(doc.savedSelections, doc.width, doc.height, (img) => applyToImage(op, img, inverse));
  const turn = op.kind === 'rotate' && inverse ? { kind: 'rotate' as const, quarterTurns: -op.quarterTurns } : op;
  doc.guides = turnGuides(doc.guides, doc.width, doc.height, turn);
  const m = losslessMatrix(turn, doc.width, doc.height);
  for (const l of doc.vectorLayers()) {
    l.resize(nw, nh);
    l.setObjects(l.objects.map((n) => transformNode(n, m)));
  }
  doc.pieces = transformPieces(doc.pieces, m);
  doc.camera = transformCamera(doc.camera, m, doc.width, doc.height, nw, nh);
  doc.cameraKeys = transformCameraKeys(doc.cameraKeys, m);
  doc.width = nw;
  doc.height = nh;
  doc.selection = null;
}

/** Flip/rotate the whole image. Stores no pixels: undo applies the inverse operation. */
export class LosslessCommand implements Command {
  readonly bytes = 64;
  constructor(
    readonly label: I18nKey,
    private readonly host: CommandHost,
    private readonly op: LosslessOp,
  ) {}

  undo(): void {
    applyLossless(this.host.doc, this.op, true);
    this.host.structureChanged();
  }

  redo(): void {
    applyLossless(this.host.doc, this.op, false);
    this.host.structureChanged();
  }
}
