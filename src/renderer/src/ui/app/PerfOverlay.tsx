import { useEffect, useRef, useState } from 'react';
import type { PerfStats } from '@engine/PerfMonitor';
import { t } from '../../i18n';
import { engine } from '../state/engine';
import { showToast, useUi } from '../state/store';

const ms = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)} ms`);
const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

interface Reading {
  stats: PerfStats;
  heap: number | null;
  memory: ReturnType<typeof engine.memoryUse>;
  frames: number[];
  size: { w: number; h: number };
}

/** Chromium's heap figure (not a web standard, so read defensively). */
function heapBytes(): number | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof m?.usedJSHeapSize === 'number' ? m.usedJSHeapSize : null;
}

const GRAPH_W = 180;
const GRAPH_H = 36;
/** The graph's top is two frames at 60 Hz; a line marks one frame. */
const GRAPH_MS = 33.4;

/** Recent frame times as bars, with a line at one 60 Hz frame (16.7 ms). */
function FrameGraph({ frames }: { frames: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = GRAPH_W * dpr;
    c.height = GRAPH_H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, GRAPH_W, GRAPH_H);
    const css = getComputedStyle(c);
    g.fillStyle = css.color;
    const bw = GRAPH_W / 120;
    frames.forEach((f, i) => {
      const hgt = Math.min(GRAPH_H, (f / GRAPH_MS) * GRAPH_H);
      g.fillRect((120 - frames.length + i) * bw, GRAPH_H - hgt, Math.max(1, bw - 0.5), hgt);
    });
    g.fillStyle = css.borderTopColor;
    g.fillRect(0, GRAPH_H - (16.7 / GRAPH_MS) * GRAPH_H, GRAPH_W, 1);
  }, [frames]);
  return <canvas ref={ref} className="perf-graph" style={{ width: GRAPH_W, height: GRAPH_H }} role="img" aria-label={t('perf.graph')} />;
}

/** Frame time, pointer-to-pixel latency and memory, over the canvas (Ctrl+Alt+Shift+P). */
export function PerfOverlay() {
  const shown = useUi((s) => s.perfOverlay);
  const [r, setR] = useState<Reading | null>(null);
  useEffect(() => {
    engine.perf.enabled = shown;
    if (!shown) return;
    const read = () =>
      setR({
        stats: engine.perf.stats(performance.now()),
        heap: heapBytes(),
        memory: engine.memoryUse(),
        frames: engine.perf.recentFrames(),
        size: { w: engine.doc.width, h: engine.doc.height },
      });
    read();
    const id = window.setInterval(read, 250);
    return () => {
      window.clearInterval(id);
      engine.perf.enabled = false;
    };
  }, [shown]);
  if (!shown || !r) return null;
  const { stats, heap, memory, size } = r;
  const rows: [string, string][] = [
    [t('perf.frame'), `${ms(stats.frame)} · p95 ${ms(stats.frameP95)}`],
    [t('perf.latency'), `${ms(stats.latency)} · p95 ${ms(stats.latencyP95)}`],
    [t('perf.fps'), String(stats.fps)],
    [t('perf.size'), `${size.w} × ${size.h} (${((size.w * size.h) / 1e6).toFixed(1)} MP)`],
    [t('perf.heap'), heap === null ? '—' : mb(heap)],
    [t('perf.image', { layers: memory.layers }), mb(memory.image)],
    [t('perf.history'), mb(memory.history)],
  ];
  const copy = () => {
    const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
    void navigator.clipboard.writeText(text).then(
      () => showToast({ kind: 'info', key: 'perf.copied' }),
      () => showToast({ kind: 'error', key: 'perf.copyFailed' }),
    );
  };
  return (
    <div className="perf-overlay" role="status" aria-label={t('perf.title')}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
      <FrameGraph frames={r.frames} />
      <button type="button" className="btn small" onClick={copy}>
        {t('perf.copy')}
      </button>
    </div>
  );
}
