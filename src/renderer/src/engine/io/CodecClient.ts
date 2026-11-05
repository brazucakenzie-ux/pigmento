import type { ImageFormat } from '@shared/formats';
import type { Rect } from '../core/geometry';
import { floodFill } from '../raster/floodFill';
import type { WorkerRequest, WorkerResponse } from './protocol';

export interface DecodedImage {
  w: number;
  h: number;
  data: Uint8ClampedArray;
  dpi: number | null;
}

export class CodecError extends Error {
  constructor(
    message: string,
    readonly code: 'too-large' | 'decode' | 'other',
  ) {
    super(message);
  }
}

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void };

/** Distribute so-called "body" types without the id, for request construction. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Talks to the codec worker: decoding, encoding and large flood fills run off the UI thread.
 * Buffers are transferred, not copied.
 */
export class CodecClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('../workers/codec.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      p.resolve(ev.data);
    };
    w.onerror = (ev) => {
      const err = new Error(ev.message || 'Worker error');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    this.worker = w;
    return w;
  }

  private call(req: DistributiveOmit<WorkerRequest, 'id'>, transfer: Transferable[]): Promise<WorkerResponse> {
    const id = ++this.seq;
    const worker = this.ensure();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...req, id }, transfer);
    });
  }

  async decode(bytes: Uint8Array): Promise<DecodedImage> {
    // Copy so the caller's buffer stays usable after transfer.
    const copy = bytes.slice();
    const res = await this.call({ type: 'decode', bytes: copy }, [copy.buffer]);
    if (!res.ok) throw new CodecError(res.error, res.code ?? 'other');
    if (res.type !== 'decode') throw new CodecError('Unexpected reply', 'other');
    return { w: res.w, h: res.h, data: res.data, dpi: res.dpi };
  }

  /** Encode RGBA (the buffer is transferred, so pass a disposable copy). */
  async encode(
    format: ImageFormat,
    w: number,
    h: number,
    data: Uint8ClampedArray,
    quality: number,
    dpi: number,
  ): Promise<Uint8Array> {
    const res = await this.call({ type: 'encode', format, w, h, data, quality, dpi }, [data.buffer]);
    if (!res.ok) throw new CodecError(res.error, 'other');
    if (res.type !== 'encode') throw new CodecError('Unexpected reply', 'other');
    return res.bytes;
  }

  /** Flood fill; images under ~1 MP run inline because the round trip costs more. */
  async fill(
    data: Uint8ClampedArray,
    w: number,
    h: number,
    x: number,
    y: number,
    tolerance: number,
    contiguous: boolean,
    clip: Uint8Array | null,
  ): Promise<{ mask: Uint8Array; bounds: Rect | null }> {
    if (w * h < 1_000_000) {
      const r = floodFill(data, w, h, x, y, { tolerance, contiguous, clip });
      return { mask: r.mask, bounds: r.bounds };
    }
    const transfer: Transferable[] = [data.buffer];
    if (clip) transfer.push(clip.buffer);
    const res = await this.call({ type: 'fill', w, h, data, x, y, tolerance, contiguous, clip }, transfer);
    if (!res.ok) throw new CodecError(res.error, 'other');
    if (res.type !== 'fill') throw new CodecError('Unexpected reply', 'other');
    return { mask: res.mask, bounds: res.bounds };
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
