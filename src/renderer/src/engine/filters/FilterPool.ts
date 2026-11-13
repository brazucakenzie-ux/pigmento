import { bandInput, filterRegistry, padOf, placeBand, planBands, runJob, type Band, type FilterJob } from './FilterRegistry';
import type { FilterRequest, FilterResponse } from './protocol';

export class FilterCancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

/** Jobs smaller than this run on the UI thread (a worker round trip would cost more). */
const INLINE_PIXELS = 160_000;

/**
 * A few filter workers sharing the bands of a job. Results come back as bands finish (for
 * progress); cancelling drops the queue and, with `stop`, ends the running workers too.
 */
export class FilterPool {
  private workers: Worker[] = [];
  private seq = 0;
  /** Ends the job in progress: one job at a time shares the workers. */
  private cancelCurrent: (() => void) | null = null;
  private readonly size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

  private spawn(): Worker {
    return new Worker(new URL('../workers/filter.worker.ts', import.meta.url), { type: 'module' });
  }

  /** End every worker now (a long run the user cancelled); new ones start on the next job. */
  stop(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }

  /**
   * Filter `job.inner`, resolving its pixels (inner size). `signal` cancels; `onProgress` gets
   * 0–1 as bands finish.
   */
  run(job: FilterJob, onProgress?: (done: number) => void, signal?: AbortSignal): Promise<Uint8ClampedArray> {
    const def = filterRegistry.get(job.filterId);
    if (!def) return Promise.reject(new Error(`Unknown filter "${job.filterId}"`));
    this.cancelCurrent?.();
    if (signal?.aborted) return Promise.reject(new FilterCancelled());
    if (job.inner.w * job.inner.h <= INLINE_PIXELS) {
      const out = runJob(job);
      onProgress?.(1);
      return Promise.resolve(out);
    }
    const bands = planBands(job.inner, job.src.h, padOf(def, job.params, job.scale), this.size);
    const out = new Uint8ClampedArray(job.inner.w * job.inner.h * 4);
    while (this.workers.length < Math.min(this.size, bands.length)) this.workers.push(this.spawn());
    return new Promise((resolve, reject) => {
      const queue = [...bands];
      let done = 0;
      let finished = false;
      const idle = [...this.workers];
      const busy = new Map<Worker, { id: number; band: Band }>();
      const finish = (err: Error | null) => {
        if (finished) return;
        finished = true;
        if (this.cancelCurrent === onAbort) this.cancelCurrent = null;
        signal?.removeEventListener('abort', onAbort);
        for (const w of this.workers) w.onmessage = w.onerror = null;
        if (err) reject(err);
        else resolve(out);
      };
      const onAbort = () => finish(new FilterCancelled());
      signal?.addEventListener('abort', onAbort);
      this.cancelCurrent = onAbort;
      const next = (w: Worker) => {
        const band = queue.shift();
        if (!band) {
          idle.push(w);
          return;
        }
        const id = ++this.seq;
        busy.set(w, { id, band });
        const input = bandInput(job, band);
        const req: FilterRequest = { id, filterId: job.filterId, params: job.params, input };
        w.onmessage = (ev: MessageEvent<FilterResponse>) => {
          const cur = busy.get(w);
          if (finished || !cur || ev.data.id !== cur.id) return;
          busy.delete(w);
          if (!ev.data.ok) return finish(new Error(ev.data.error));
          placeBand(job, cur.band, ev.data.data, out);
          done++;
          onProgress?.(done / bands.length);
          if (done === bands.length) finish(null);
          else next(w);
        };
        w.onerror = (ev) => {
          // A broken worker is replaced; the job fails.
          this.workers = this.workers.filter((x) => x !== w);
          w.terminate();
          finish(new Error(ev.message || 'Filter worker failed'));
        };
        w.postMessage(req, [input.data.buffer]);
      };
      for (const w of idle.splice(0)) next(w);
    });
  }
}
