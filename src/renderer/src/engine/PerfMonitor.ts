/**
 * Timing for the performance overlay (and perf tests): how long each frame takes to draw, how
 * long a pointer event waits until its pixels are drawn, and frames per second. It records
 * only while switched on, in rings of the latest samples.
 */
const KEEP = 240;

function push(ring: number[], v: number): void {
  ring.push(v);
  if (ring.length > KEEP) ring.shift();
}

function quantile(ring: readonly number[], q: number): number | null {
  if (!ring.length) return null;
  const s = [...ring].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

export interface PerfStats {
  /** Time spent drawing a frame (ms): median and 95th percentile. */
  frame: number | null;
  frameP95: number | null;
  /** Pointer event to its pixels drawn (ms). */
  latency: number | null;
  latencyP95: number | null;
  /** Frames drawn in the last second. */
  fps: number;
}

export class PerfMonitor {
  private on = false;
  private frames: number[] = [];
  private latencies: number[] = [];
  private stamps: number[] = [];
  /** The oldest pointer event not yet drawn. */
  private pending: number | null = null;

  get enabled(): boolean {
    return this.on;
  }

  set enabled(v: boolean) {
    this.on = v;
    if (!v) this.reset();
  }

  reset(): void {
    this.frames = [];
    this.latencies = [];
    this.stamps = [];
    this.pending = null;
  }

  /** A pointer event arrived (its `timeStamp`, on the performance clock). */
  input(timeStamp: number): void {
    if (this.on && this.pending === null) this.pending = timeStamp;
  }

  /** A frame was drawn from `start` to `end` (performance clock). */
  frame(start: number, end: number): void {
    if (!this.on) return;
    push(this.frames, end - start);
    push(this.stamps, end);
    if (this.pending !== null) {
      push(this.latencies, Math.max(0, end - this.pending));
      this.pending = null;
    }
  }

  /** The latest frame times (ms), oldest first (for the overlay's graph). */
  recentFrames(n = 120): number[] {
    return this.frames.slice(-n);
  }

  stats(now: number): PerfStats {
    return {
      frame: quantile(this.frames, 0.5),
      frameP95: quantile(this.frames, 0.95),
      latency: quantile(this.latencies, 0.5),
      latencyP95: quantile(this.latencies, 0.95),
      fps: this.stamps.filter((t) => now - t <= 1000).length,
    };
  }
}
