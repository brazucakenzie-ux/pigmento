import type { ImageBuf } from '../raster/transform';
import type { SavedSelection } from './Document';
import { Selection } from './Selection';

/** The selection as a docW×docH image whose alpha is the mask (for the layer transforms). */
function toImage(sel: Selection, docW: number, docH: number): ImageBuf {
  const data = new Uint8ClampedArray(docW * docH * 4);
  const b = sel.bounds;
  for (let y = Math.max(0, b.y); y < Math.min(docH, b.y + b.h); y++) {
    for (let x = Math.max(0, b.x); x < Math.min(docW, b.x + b.w); x++) {
      const v = sel.mask[(y - b.y) * b.w + (x - b.x)];
      if (v) data[(y * docW + x) * 4 + 3] = v;
    }
  }
  return { w: docW, h: docH, data };
}

function fromImage(img: ImageBuf): Selection | null {
  const mask = new Uint8Array(img.w * img.h);
  for (let i = 0; i < mask.length; i++) mask[i] = img.data[i * 4 + 3];
  return Selection.fromPlaced({ bounds: { x: 0, y: 0, w: img.w, h: img.h }, mask });
}

/**
 * Apply a whole-image pixel transform (flip, rotate, resize, crop…) to every saved selection.
 * Selections that end up empty are dropped.
 */
export function transformSaved(
  list: readonly SavedSelection[],
  docW: number,
  docH: number,
  fn: (img: ImageBuf) => ImageBuf,
): SavedSelection[] {
  const out: SavedSelection[] = [];
  for (const s of list) {
    const sel = fromImage(fn(toImage(s.selection, docW, docH)));
    if (sel) out.push({ id: s.id, name: s.name, selection: sel });
  }
  return out;
}
