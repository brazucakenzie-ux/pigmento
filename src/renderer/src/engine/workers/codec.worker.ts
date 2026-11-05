// Runs in a dedicated worker; `self` is typed as Window under the DOM lib, so posts are cast.
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { FORMATS } from '@shared/formats';
import { encodeBmp, jpegWithDpi, pngWithDpi, readDpi } from '../io/codecs';
import { MAX_DIMENSION, MAX_PIXELS, type WorkerRequest, type WorkerResponse } from '../io/protocol';
import { floodFill } from '../raster/floodFill';

function reply(msg: WorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(msg, transfer);
}

async function decode(id: number, bytes: Uint8Array): Promise<void> {
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  const { width: w, height: h } = bitmap;
  if (w > MAX_DIMENSION || h > MAX_DIMENSION || w * h > MAX_PIXELS) {
    bitmap.close();
    reply({ id, ok: false, error: `${w}x${h}`, code: 'too-large' });
    return;
  }
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D context');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const img = ctx.getImageData(0, 0, w, h);
  reply({ id, ok: true, type: 'decode', w, h, data: img.data, dpi: readDpi(bytes) }, [img.data.buffer]);
}

function encodeGif(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 128) {
      hasAlpha = true;
      break;
    }
  }
  const format = hasAlpha ? 'rgba4444' : 'rgb565';
  const palette = quantize(data, 256, { format, oneBitAlpha: hasAlpha, clearAlpha: hasAlpha, clearAlphaThreshold: 127 });
  const index = applyPalette(data, palette, format);
  const transparentIndex = hasAlpha ? palette.findIndex((c) => c.length > 3 && c[3] === 0) : -1;
  const gif = GIFEncoder();
  gif.writeFrame(index, w, h, {
    palette,
    transparent: transparentIndex >= 0,
    transparentIndex: Math.max(0, transparentIndex),
  });
  gif.finish();
  return gif.bytes();
}

async function encode(req: Extract<WorkerRequest, { type: 'encode' }>): Promise<void> {
  const { id, format, w, h, data, quality, dpi } = req;
  let bytes: Uint8Array;
  if (format === 'bmp') {
    bytes = encodeBmp(data, w, h, dpi);
  } else if (format === 'gif') {
    bytes = encodeGif(data, w, h);
  } else {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
    const blob = await canvas.convertToBlob({ type: FORMATS[format].mime, quality: quality / 100 });
    if (blob.type !== FORMATS[format].mime) throw new Error(`Encoder produced ${blob.type}`);
    bytes = new Uint8Array(await blob.arrayBuffer());
    if (format === 'png') bytes = pngWithDpi(bytes, dpi);
    if (format === 'jpeg') bytes = jpegWithDpi(bytes, dpi);
  }
  reply({ id, ok: true, type: 'encode', bytes }, [bytes.buffer]);
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const run = async () => {
    if (req.type === 'decode') await decode(req.id, req.bytes);
    else if (req.type === 'encode') await encode(req);
    else {
      const r = floodFill(req.data, req.w, req.h, req.x, req.y, {
        tolerance: req.tolerance,
        contiguous: req.contiguous,
        clip: req.clip,
      });
      reply({ id: req.id, ok: true, type: 'fill', mask: r.mask, bounds: r.bounds }, [r.mask.buffer]);
    }
  };
  run().catch((err: unknown) => {
    reply({
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: req.type === 'decode' ? 'decode' : undefined,
    });
  });
};
