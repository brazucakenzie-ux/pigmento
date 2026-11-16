/**
 * An animated GIF built a frame at a time in a worker (the encoder keeps its state there, and
 * frames are sent as they're rendered so a long animation never sits in memory twice).
 */
export interface GifStart {
  type: 'start';
  w: number;
  h: number;
  /** 0 = repeat forever, -1 = play once. */
  repeat: number;
  /** Frames can be see-through (then each frame replaces the last instead of piling up). */
  transparent: boolean;
}
export interface GifFrame {
  type: 'frame';
  data: Uint8ClampedArray;
  /** Milliseconds on screen (GIF counts in hundredths, so this is rounded to 10 ms). */
  delay: number;
}
export interface GifFinish {
  type: 'finish';
}
export type GifRequest = GifStart | GifFrame | GifFinish;

export type GifResponse = { type: 'frame-done'; index: number } | { type: 'done'; bytes: Uint8Array } | { type: 'error'; message: string };

/** Talks to one GIF worker for one export; `abort()` ends it at once. */
export class GifStream {
  private worker: Worker | null = new Worker(new URL('../workers/gif.worker.ts', import.meta.url), { type: 'module' });
  private done: Promise<Uint8Array>;
  private resolveDone!: (b: Uint8Array) => void;
  private rejectDone!: (e: Error) => void;
  /** Frames the worker has finished (for back-pressure: don't race ahead of it). */
  private finished = 0;
  private waiters: { n: number; resolve: () => void }[] = [];

  constructor(start: Omit<GifStart, 'type'>) {
    this.done = new Promise((res, rej) => {
      this.resolveDone = res;
      this.rejectDone = rej;
    });
    // A rejection nobody awaits yet (abort before finish) mustn't surface as an error.
    this.done.catch(() => undefined);
    const w = this.worker!;
    w.onmessage = (ev: MessageEvent<GifResponse>) => {
      const m = ev.data;
      if (m.type === 'frame-done') {
        this.finished = m.index + 1;
        this.waiters = this.waiters.filter((x) => (x.n <= this.finished ? (x.resolve(), false) : true));
      } else if (m.type === 'done') {
        this.resolveDone(m.bytes);
        this.dispose();
      } else {
        this.rejectDone(new Error(m.message));
        this.dispose();
      }
    };
    w.onerror = (ev) => {
      ev.preventDefault();
      this.rejectDone(new Error(ev.message || 'GIF worker failed'));
      this.dispose();
    };
    this.post({ type: 'start', ...start });
  }

  private post(m: GifRequest, transfer: Transferable[] = []): void {
    this.worker?.postMessage(m, transfer);
  }

  /** Send a frame (its pixels move to the worker). */
  frame(data: Uint8ClampedArray, delay: number): void {
    this.post({ type: 'frame', data, delay }, [data.buffer]);
  }

  /** Resolves once the worker has encoded at least `n` frames. */
  async encoded(n: number): Promise<void> {
    if (this.finished >= n || !this.worker) return;
    await new Promise<void>((resolve) => this.waiters.push({ n, resolve }));
  }

  finish(): Promise<Uint8Array> {
    this.post({ type: 'finish' });
    return this.done;
  }

  abort(): void {
    this.rejectDone(new Error('aborted'));
    this.dispose();
  }

  private dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const w of this.waiters) w.resolve();
    this.waiters = [];
  }
}
