import type { PaintDocument } from '../doc/Document';
import { Surface } from '../raster/Surface';
import { flipH, flipV, rotate90, type ImageBuf } from '../raster/transform';
import { transformSaved } from '../doc/savedSelections';
import type { I18nKey } from '../../i18n';
import type { CommandHost } from './commands';
import type { Command } from './History';

export type LosslessOp = { kind: 'flip'; axis: 'h' | 'v' } | { kind: 'rotate'; quarterTurns: number };

function applyToImage(op: LosslessOp, img: ImageBuf, inverse: boolean): ImageBuf {
  if (op.kind === 'flip') return op.axis === 'h' ? flipH(img) : flipV(img);
  return rotate90(img, inverse ? -op.quarterTurns : op.quarterTurns);
}

/** Apply a lossless whole-image op to every layer (and the document size). */
export function applyLossless(doc: PaintDocument, op: LosslessOp, inverse: boolean): void {
  // A quarter turn swaps the document's width and height.
  const swap = op.kind === 'rotate' && op.quarterTurns % 2 !== 0;
  const nw = swap ? doc.height : doc.width;
  const nh = swap ? doc.width : doc.height;
  for (const layer of doc.rasterLayers()) {
    const s = layer.surface;
    const out = applyToImage(op, { w: s.width, h: s.height, data: s.toRGBA() }, inverse);
    layer.surface = Surface.fromRGBA(out.w, out.h, out.data);
  }
  doc.savedSelections = transformSaved(doc.savedSelections, doc.width, doc.height, (img) => applyToImage(op, img, inverse));
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
