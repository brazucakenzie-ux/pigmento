// Runs in a dedicated worker: an animated GIF, one frame per message (see io/gifStream.ts).
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { GifRequest, GifResponse, GifStart } from '../io/gifStream';

function reply(msg: GifResponse, transfer: Transferable[] = []): void {
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(msg, transfer);
}

let opts: GifStart | null = null;
let gif: ReturnType<typeof GIFEncoder> | null = null;
let index = 0;

function addFrame(data: Uint8ClampedArray, delay: number): void {
  if (!opts || !gif) throw new Error('GIF not started');
  const { w, h, transparent } = opts;
  if (data.length !== w * h * 4) throw new Error('Frame has the wrong size');
  // Each frame gets its own 256-colour palette (colours change as things move).
  const format = transparent ? 'rgba4444' : 'rgb565';
  const palette = quantize(data, 256, { format, oneBitAlpha: transparent, clearAlpha: transparent, clearAlphaThreshold: 127 });
  const pixels = applyPalette(data, palette, format);
  const clear = transparent ? palette.findIndex((c) => c.length > 3 && c[3] === 0) : -1;
  gif.writeFrame(pixels, w, h, {
    palette,
    delay: Math.max(10, Math.round(delay / 10) * 10),
    // Only the first frame carries the loop setting.
    repeat: index === 0 ? opts.repeat : undefined,
    transparent: clear >= 0,
    transparentIndex: Math.max(0, clear),
    // See-through frames replace the last one instead of piling up on it.
    dispose: transparent ? 2 : 1,
  });
  reply({ type: 'frame-done', index });
  index++;
}

self.onmessage = (ev: MessageEvent<GifRequest>) => {
  const m = ev.data;
  try {
    if (m.type === 'start') {
      opts = m;
      gif = GIFEncoder();
      index = 0;
    } else if (m.type === 'frame') {
      addFrame(m.data, m.delay);
    } else {
      if (!gif) throw new Error('GIF not started');
      gif.finish();
      const bytes = gif.bytes();
      gif = null;
      reply({ type: 'done', bytes }, [bytes.buffer]);
    }
  } catch (err) {
    reply({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
