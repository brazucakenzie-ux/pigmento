import { frameDelays } from '../anim/exportFrames';
import { GifStream } from './gifStream';
import { avcCodecFor, muxMp4, type Mp4Sample } from './mp4';

export type AnimFormat = 'gif' | 'mp4';
export type VideoQuality = 'low' | 'medium' | 'high';

export interface AnimEncodeRequest {
  format: AnimFormat;
  /** Frame numbers in the order they play (see frameSequence). */
  frames: readonly number[];
  fps: number;
  /** GIF: 0 = repeat forever, -1 = play once. */
  repeat: number;
  /** GIF only: keep see-through pixels see-through. */
  transparent: boolean;
  quality: VideoQuality;
}

/**
 * Renders a frame at the export's size and background (the engine's animationFrameCanvas). The
 * canvas may be reused for the next frame, so it's read before asking for another.
 */
export type FrameSource = (frame: number) => OffscreenCanvas;

export class AnimExportError extends Error {
  constructor(
    readonly key: 'error.videoTooLarge' | 'error.videoUnsupported' | 'error.animExport',
    message: string,
  ) {
    super(message);
  }
}

/** Bits per pixel per frame for each quality (High is about 8 Mbit/s for 1080p at 24 fps). */
const BITS_PER_PIXEL: Record<VideoQuality, number> = { low: 0.05, medium: 0.1, high: 0.17 };

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
}

/** Let the interface draw (progress) between frames. */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

/** Encode the frames as an animated GIF or an MP4 video. Throws AbortError when cancelled. */
export async function encodeAnimation(
  render: FrameSource,
  req: AnimEncodeRequest,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!req.frames.length) throw new AnimExportError('error.animExport', 'No frames');
  return req.format === 'gif' ? encodeGif(render, req, onProgress, signal) : encodeMp4(render, req, onProgress, signal);
}

async function encodeGif(render: FrameSource, req: AnimEncodeRequest, onProgress: (d: number, t: number) => void, signal: AbortSignal): Promise<Uint8Array> {
  const total = req.frames.length;
  // GIF counts time in hundredths of a second.
  const delays = frameDelays(total, req.fps, 10);
  let stream: GifStream | null = null;
  try {
    for (let i = 0; i < total; i++) {
      abortIfNeeded(signal);
      const c = render(req.frames[i]);
      const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
      const img = ctx.getImageData(0, 0, c.width, c.height);
      stream ??= new GifStream({ w: c.width, h: c.height, repeat: req.repeat, transparent: req.transparent });
      stream.frame(img.data, delays[i]);
      // Stay at most a few frames ahead of the encoder, so memory stays flat.
      await stream.encoded(i - 2);
      onProgress(i + 1, total);
      await breathe();
    }
    abortIfNeeded(signal);
    return await stream!.finish();
  } catch (err) {
    stream?.abort();
    throw err;
  }
}

let padded: OffscreenCanvas | null = null;

/** A frame padded to even width and height (H.264 needs them), repeating the last column/row. */
function padEven(c: OffscreenCanvas): OffscreenCanvas {
  const w = c.width + (c.width & 1);
  const h = c.height + (c.height & 1);
  if (w === c.width && h === c.height) return c;
  if (!padded || padded.width !== w || padded.height !== h) padded = new OffscreenCanvas(w, h);
  const ctx = padded.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(c, 0, 0);
  if (w !== c.width) ctx.drawImage(c, c.width - 1, 0, 1, c.height, c.width, 0, 1, c.height);
  if (h !== c.height) ctx.drawImage(padded, 0, c.height - 1, w, 1, 0, c.height, w, 1);
  return padded;
}

async function encodeMp4(render: FrameSource, req: AnimEncodeRequest, onProgress: (d: number, t: number) => void, signal: AbortSignal): Promise<Uint8Array> {
  if (typeof VideoEncoder !== 'function') throw new AnimExportError('error.videoUnsupported', 'No VideoEncoder');
  const total = req.frames.length;
  const probe = render(req.frames[0]);
  const width = probe.width + (probe.width & 1);
  const height = probe.height + (probe.height & 1);
  const codec = avcCodecFor(width, height);
  if (!codec) throw new AnimExportError('error.videoTooLarge', `${width}x${height}`);
  const config: VideoEncoderConfig = {
    codec,
    width,
    height,
    framerate: req.fps,
    bitrate: Math.max(300_000, Math.round(width * height * req.fps * BITS_PER_PIXEL[req.quality])),
    avc: { format: 'avc' },
    latencyMode: 'quality',
  };
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) throw new AnimExportError('error.videoUnsupported', codec);
  const samples: Mp4Sample[] = [];
  let avcC: Uint8Array | null = null;
  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const desc = meta?.decoderConfig?.description;
      if (desc && !avcC) avcC = new Uint8Array(desc instanceof ArrayBuffer ? desc.slice(0) : (desc as ArrayBufferView).buffer.slice(0));
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, key: chunk.type === 'key' });
    },
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e));
    },
  });
  try {
    encoder.configure(config);
    // A keyframe every two seconds, so players can seek.
    const keyEvery = Math.max(1, Math.round(req.fps * 2));
    for (let i = 0; i < total; i++) {
      abortIfNeeded(signal);
      if (failure) throw failure;
      const img = padEven(render(req.frames[i]));
      if (img.width !== width || img.height !== height) throw new AnimExportError('error.animExport', 'Frame size changed');
      // Straight from the GPU canvas to the encoder: no read-back.
      const frame = new VideoFrame(img, { timestamp: Math.round((i * 1e6) / req.fps), duration: Math.round(1e6 / req.fps) });
      encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      // Don't let frames pile up waiting for the encoder.
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 4));
      onProgress(i + 1, total);
      await breathe();
    }
    await encoder.flush();
    if (failure) throw failure;
    abortIfNeeded(signal);
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (!avcC || samples.length !== total) throw new AnimExportError('error.animExport', `Encoder gave ${samples.length} of ${total} frames`);
  return muxMp4({ width, height, fps: req.fps, avcC, samples });
}
