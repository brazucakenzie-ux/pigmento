/**
 * Images used as shape fills. Kept for the whole session (not per document), so undo never
 * loses one and a fill picked once can be reused in a new image; projects save the ones their
 * shapes use. Ids come from the pixels, so the same picture is stored once.
 */
export interface ImageAsset {
  readonly id: string;
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;
}

/** Most pixels one fill image may have (larger pictures are scaled down when picked). */
export const MAX_ASSET_PIXELS = 4096 * 4096;
export const ASSET_ID = /^img-[0-9a-f]{8}-\d{1,5}x\d{1,5}$/;

const assets = new Map<string, ImageAsset>();
const canvases = new Map<string, OffscreenCanvas>();

function hashPixels(data: Uint8ClampedArray): string {
  // FNV-1a over a sample of the pixels (every pixel for small images).
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(data.length / 4 / 65536)) * 4;
  for (let i = 0; i < data.length; i += step) {
    h ^= data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function assetIdFor(w: number, h: number, data: Uint8ClampedArray): string {
  return `img-${hashPixels(data)}-${w}x${h}`;
}

/** Add an image (or find the same one) and return its id. */
export function addImageAsset(w: number, h: number, data: Uint8ClampedArray, id = assetIdFor(w, h, data)): string {
  if (assets.has(id)) return id;
  assets.set(id, { id, w, h, data: new Uint8ClampedArray(data) });
  return id;
}

export function imageAsset(id: string): ImageAsset | undefined {
  return assets.get(id);
}

/** The image as a canvas for drawing (made on first use). */
export function assetCanvas(id: string): OffscreenCanvas | null {
  const a = assets.get(id);
  if (!a) return null;
  let c = canvases.get(id);
  if (!c) {
    c = new OffscreenCanvas(a.w, a.h);
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(a.data), a.w, a.h), 0, 0);
    canvases.set(id, c);
  }
  return c;
}
